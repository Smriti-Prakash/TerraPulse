"""Citizen incident reports: intake, map/data checks, rule-based priority, Gemini report check, officer queue.

Flow: a signed-in citizen submits a photo + location -> backend validates the location is inside the study area,
stores a downscaled copy of the photo, runs deterministic checks against the data TerraPulse has, scores a
rule-based priority, then (in the background) asks Gemini to compare the photo, the note and the check results.
Gemini never sets the priority and never decides legality; the officer always decides.
"""
from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import ExifTags, Image, ImageOps
from pydantic import BaseModel, Field

from . import config, db, prompts
from .core import COMMUNITY_STATEMENT, UNAVAILABLE, engine
from .gemini import GeminiError, generate, parse_json

UPLOAD_DIR = Path(os.getenv("TERRAPULSE_UPLOADS", config.BASE / "uploads"))
FIRE_CSV = Path(os.getenv("TERRAPULSE_FIRE_CSV", config.BASE / "data" / "fire_detections.csv"))
BOUNDARY_GEOJSON = Path(os.getenv("TERRAPULSE_BOUNDARY", config.BASE / "data" / "reserve_boundary.geojson"))
REGION_MARGIN_DEG = float(os.getenv("TERRAPULSE_REGION_MARGIN", "0.10"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_REPORTS_PER_HOUR = int(os.getenv("TERRAPULSE_MAX_REPORTS_PER_HOUR", "5"))
Image.MAX_IMAGE_PIXELS = 60_000_000

CATEGORIES = ("fire", "deforestation", "other")
OFFICER_STATUSES = ("NEW", "UNDER REVIEW", "NEEDS FIELD VISIT", "VERIFIED", "FALSE REPORT")
CITIZEN_STATUS_LABEL = {"NEW": "Received", "UNDER REVIEW": "Under review", "NEEDS FIELD VISIT": "Under review",
                        "VERIFIED": "Action taken", "FALSE REPORT": "Closed"}
LEGALITY_NOTE = ("Legality cannot be determined from a photo or satellite data. It depends on permits, land status and "
                 "reserve boundaries that only the forest department can check.")
CREDIBILITY = ("SUPPORTED", "PARTLY SUPPORTED", "NOT SUPPORTED", "INCONCLUSIVE")
LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"]
FLAG_WORDS = re.compile(r"\b(illegal|illegally|unlawful|poach\w*|criminal\w*|confirmed fire|fire is confirmed|confirmed (?:deforestation|logging))\b", re.I)

router = APIRouter(prefix="/api/citizen", tags=["citizen"])
officer = APIRouter(prefix="/api/field-reports", tags=["field-reports"])

SCHEMA = """CREATE TABLE IF NOT EXISTS field_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, reporter_name TEXT NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL,
  lat REAL NOT NULL, lon REAL NOT NULL, accuracy_m REAL, client_time TEXT, photo_file TEXT NOT NULL,
  exif TEXT NOT NULL, checks TEXT NOT NULL, priority_score INTEGER NOT NULL, priority_level TEXT NOT NULL, priority_reasons TEXT NOT NULL,
  ai_status TEXT NOT NULL, ai_result TEXT, ai_error TEXT, ai_model TEXT,
  status TEXT NOT NULL, officer_notes TEXT NOT NULL DEFAULT '', reviewed_by TEXT, created REAL NOT NULL, updated REAL NOT NULL);"""


def init() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db.conn() as c:
        c.execute(SCHEMA)


# ------------------------------------------------------------------ geo helpers
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


def region() -> dict[str, float]:
    """Study-area box = bounding box of the sampled points plus a margin."""
    df = engine.df
    if df is None:
        raise HTTPException(503, "TerraPulse data not available")
    lat, lon = df["lat"].dropna(), df["lon"].dropna()
    m = REGION_MARGIN_DEG
    return {"south": float(lat.min()) - m, "north": float(lat.max()) + m, "west": float(lon.min()) - m, "east": float(lon.max()) + m, "margin_deg": m}


def _in_ring(lat: float, lon: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _in_polygon(lat: float, lon: float, poly: list[list[list[float]]]) -> bool:
    return _in_ring(lat, lon, poly[0]) and not any(_in_ring(lat, lon, h) for h in poly[1:])


# ------------------------------------------------------- optional data layers
_cache: dict[str, tuple[float, Any]] = {}


def _cached(path: Path, loader):
    try:
        m = path.stat().st_mtime
    except OSError:
        return None
    hit = _cache.get(str(path))
    if hit and hit[0] == m:
        return hit[1]
    val = loader(path)
    _cache[str(path)] = (m, val)
    return val


def _load_fire(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    need = {"latitude", "longitude", "acq_date"}
    if not need.issubset(df.columns):
        raise ValueError(f"fire detections file needs columns {sorted(need)}")
    t = df["acq_time"].fillna(0).astype(int).astype(str).str.zfill(4) if "acq_time" in df.columns else "0000"
    df["_dt"] = pd.to_datetime(df["acq_date"].astype(str) + " " + t, format="%Y-%m-%d %H%M", utc=True, errors="coerce")
    return df.dropna(subset=["latitude", "longitude", "_dt"])


def fire_check(lat: float, lon: float, at: float) -> dict[str, Any]:
    try:
        df = _cached(FIRE_CSV, _load_fire)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": f"Fire detections file could not be read: {e}"}
    if df is None or df.empty:
        return {"status": "unavailable", "message": UNAVAILABLE + " (no NASA FIRMS fire-detection file loaded)"}
    when = pd.Timestamp(at, unit="s", tz="UTC")
    lo, hi = df["_dt"].min(), df["_dt"].max()
    if when < lo or when > hi + pd.Timedelta(days=1):
        return {"status": "not_covered", "message": f"Fire-detection file covers {lo:%Y-%m-%d} to {hi:%Y-%m-%d}; it does not cover the report date.",
                "coverage": [f"{lo:%Y-%m-%d}", f"{hi:%Y-%m-%d}"]}
    d = df.assign(_km=[haversine_km(lat, lon, a, b) for a, b in zip(df["latitude"], df["longitude"])])
    d = d[(d["_km"] <= 10) & (d["_dt"] <= when + pd.Timedelta(hours=1))].sort_values("_km")
    out: dict[str, Any] = {"status": "ok", "coverage": [f"{lo:%Y-%m-%d}", f"{hi:%Y-%m-%d}"], "detections_within_10km": int(len(d)),
                           "recent_within_5km_72h": False, "nearest": None}
    if len(d):
        r = d.iloc[0]
        hours = (when - r["_dt"]).total_seconds() / 3600
        out["nearest"] = {"distance_km": round(float(r["_km"]), 2), "detected_utc": f"{r['_dt']:%Y-%m-%d %H:%M}", "hours_before_report": round(hours, 1),
                          "confidence": str(r["confidence"]) if "confidence" in d.columns else UNAVAILABLE}
        out["recent_within_5km_72h"] = bool(((d["_km"] <= 5) & ((when - d["_dt"]) <= pd.Timedelta(hours=72))).any())
    return out


def _load_boundary(path: Path) -> list[dict[str, Any]]:
    gj = json.loads(path.read_text(encoding="utf-8"))
    feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj]
    out = []
    for f in feats:
        g = f.get("geometry", f)
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        if polys:
            out.append({"name": (f.get("properties") or {}).get("name"), "polys": polys})
    return out


def boundary_check(lat: float, lon: float) -> dict[str, Any]:
    try:
        feats = _cached(BOUNDARY_GEOJSON, _load_boundary)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": f"Boundary file could not be read: {e}"}
    if not feats:
        return {"status": "unavailable", "message": UNAVAILABLE + " (no reserve boundary file loaded)"}
    for f in feats:
        if any(_in_polygon(lat, lon, p) for p in f["polys"]):
            return {"status": "ok", "inside": True, "name": f["name"]}
    return {"status": "ok", "inside": False, "name": None}


# ------------------------------------------------------------------- the photo
def _gps(exif: Image.Exif) -> tuple[float, float] | None:
    try:
        g = exif.get_ifd(0x8825)
        if not g or 2 not in g or 4 not in g:
            return None

        def deg(v, ref):
            d = float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600
            return -d if ref in ("S", "W") else d
        return deg(g[2], g.get(1, "N")), deg(g[4], g.get(3, "E"))
    except Exception:  # noqa: BLE001
        return None


def process_photo(raw: bytes) -> tuple[str, dict[str, Any]]:
    """Validate the image, read EXIF facts, store a downscaled JPEG WITHOUT EXIF. Returns (file name, exif facts)."""
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Photo is larger than 10 MB. Lower the camera resolution and try again.")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        if fmt not in ("JPEG", "PNG", "WEBP"):
            raise ValueError(fmt)
        exif = probe.getexif()
        gps = _gps(exif)
        taken = None
        try:
            taken = exif.get_ifd(0x8769).get(36867) or exif.get(306)
        except Exception:  # noqa: BLE001
            taken = exif.get(306)
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(422, "The file is not a valid JPEG, PNG or WebP photo.")
    img.thumbnail((1600, 1600))
    name = uuid.uuid4().hex + ".jpg"
    img.save(UPLOAD_DIR / name, "JPEG", quality=85)
    facts = {"has_exif": bool(len(exif)), "exif_gps": {"lat": gps[0], "lon": gps[1]} if gps else None,
             "exif_time": str(taken) if taken else None, "original_format": fmt, "stored_size_px": list(img.size)}
    return name, facts


# ------------------------------------------------------- checks + priority rule
def build_checks(lat: float, lon: float, accuracy_m: float | None, exif: dict[str, Any], username: str, at: float) -> dict[str, Any]:
    near = sorted(({"incident_id": r["incident_id"], "distance_km": round(haversine_km(lat, lon, r["lat"], r["lon"]), 2),
                    "risk_level": r["risk"]["level"], "ml_probability": round(r["ml"]["probability"], 3),
                    "thermal_signal": r["risk"]["signals"]["thermal_signal"], "vegetation_anomaly": r["risk"]["signals"]["vegetation_anomaly"]}
                   for r in engine.records if r["lat"] is not None and r["incident_id"]), key=lambda x: x["distance_km"])[:3]
    elevated = next((n for n in near if n["risk_level"] != "LOW" and n["distance_km"] <= 3), None)
    with db.conn() as c:
        rows = c.execute("SELECT username, lat, lon FROM field_reports WHERE created > ? AND username != ?", (at - 24 * 3600, username)).fetchall()
    others = {r["username"] for r in rows if haversine_km(lat, lon, r["lat"], r["lon"]) <= 0.5}
    geotag = None
    if exif["exif_gps"]:
        d = haversine_km(lat, lon, exif["exif_gps"]["lat"], exif["exif_gps"]["lon"])
        geotag = {"distance_km": round(d, 2), "consistent": d <= 1.0}
    return {
        "region": {"inside_study_area": True, "study_area": config.STUDY_AREA},
        "nearest_observations": near,
        "elevated_observation_within_3km": elevated,
        "fire_detections": fire_check(lat, lon, at),
        "reserve_boundary": boundary_check(lat, lon),
        "tree_cover_loss": {"status": "unavailable", "message": UNAVAILABLE},
        "weather": {"status": "unavailable", "message": UNAVAILABLE},
        "base_imagery": {"status": "unavailable", "message": "Base satellite image check is not included in this version"},
        "other_reports_nearby": {"distinct_other_reporters": len(others), "radius_m": 500, "window_hours": 24},
        "photo": {"has_exif": exif["has_exif"], "exif_time": exif["exif_time"], "exif_geotag_vs_reported": geotag,
                  "reported_accuracy_m": accuracy_m,
                  "note": "Missing photo metadata is common (many apps strip it) and is not evidence against a report."},
    }


def priority(category: str, checks: dict[str, Any]) -> dict[str, Any]:
    """Rule-based report priority (0-4). Gemini does not influence it."""
    base = {"fire": 2, "deforestation": 1, "other": 0}[category]
    score, reasons, not_triggered = base, [f"+{base} Citizen {category} report (unverified)"], []
    fd = checks["fire_detections"]
    if fd["status"] == "ok" and fd["recent_within_5km_72h"]:
        score += 2
        reasons.append("+2 Satellite fire detection within 5 km in the 72 hours before the report")
    else:
        not_triggered.append("Fire detection within 5 km / 72 h: " + (fd.get("message") or "none found"))
    el = checks["elevated_observation_within_3km"]
    if el:
        score += 1
        reasons.append(f"+1 Nearby observation {el['incident_id']} ({el['risk_level']}) within 3 km")
    else:
        not_triggered.append("No MODERATE-or-higher TerraPulse observation within 3 km")
    if checks["other_reports_nearby"]["distinct_other_reporters"] >= 2:
        score += 1
        reasons.append("+1 Two or more other people reported within 500 m in the last 24 hours")
    else:
        not_triggered.append("Fewer than 2 other reporters nearby in 24 hours")
    score = min(score, 4)
    level = LEVELS[0] if score <= 1 else LEVELS[score - 1]
    return {"score": score, "level": level, "reasons": reasons, "not_triggered": not_triggered,
            "rule": "Base: fire 2, deforestation 1, other 0. +2 recent fire detection within 5 km, +1 elevated TerraPulse observation within 3 km, +1 two or more other reporters. 0-1 LOW, 2 MODERATE, 3 HIGH, 4 CRITICAL."}


# ------------------------------------------------------------------------ rows
def _row(rid: int) -> dict[str, Any] | None:
    with db.conn() as c:
        r = c.execute("SELECT * FROM field_reports WHERE id=?", (rid,)).fetchone()
    return dict(r) if r else None


def _save_ai(rid: int, status: str, result: dict | None = None, error: str | None = None, model: str | None = None) -> None:
    with db.conn() as c:
        c.execute("UPDATE field_reports SET ai_status=?, ai_result=?, ai_error=?, ai_model=?, updated=? WHERE id=?",
                  (status, json.dumps(result) if result is not None else None, error, model, time.time(), rid))


def citizen_view(r: dict[str, Any]) -> dict[str, Any]:
    return {"id": r["id"], "category": r["category"], "note": r["note"], "lat": r["lat"], "lon": r["lon"], "created": r["created"],
            "status": CITIZEN_STATUS_LABEL.get(r["status"], "Received"), "photo_url": f"/api/citizen/reports/{r['id']}/photo"}


def officer_view(r: dict[str, Any], full: bool = False) -> dict[str, Any]:
    out = {"id": r["id"], "category": r["category"], "lat": r["lat"], "lon": r["lon"], "created": r["created"], "status": r["status"],
           "reporter_name": r["reporter_name"], "username": r["username"], "priority_level": r["priority_level"], "priority_score": r["priority_score"],
           "ai_status": r["ai_status"], "credibility": (json.loads(r["ai_result"]).get("credibility") if r["ai_result"] else None),
           "note_preview": r["note"][:120]}
    if full:
        out.update({"note": r["note"], "accuracy_m": r["accuracy_m"], "client_time": r["client_time"], "exif": json.loads(r["exif"]),
                    "checks": json.loads(r["checks"]), "priority_reasons": json.loads(r["priority_reasons"]),
                    "ai": json.loads(r["ai_result"]) if r["ai_result"] else None, "ai_error": r["ai_error"], "ai_model": r["ai_model"],
                    "officer_notes": r["officer_notes"], "reviewed_by": r["reviewed_by"], "updated": r["updated"],
                    "photo_url": f"/api/field-reports/{r['id']}/photo", "legality": LEGALITY_NOTE,
                    "label": "Citizen report, unverified until an officer reviews it"})
    return out


# ----------------------------------------------------------------- the AI check
def ai_facts(r: dict[str, Any]) -> dict[str, Any]:
    checks = json.loads(r["checks"])
    pr = {"score": r["priority_score"], "level": r["priority_level"], "reasons": json.loads(r["priority_reasons"])["reasons"]}
    return {
        "report_id": r["id"],
        "data_mode": "Citizen report plus HISTORICAL TerraPulse observations. TerraPulse is not a live feed.",
        "report": {"category_chosen_by_citizen": r["category"], "citizen_note_UNTRUSTED_TEXT": r["note"],
                   "reported_location": {"latitude": r["lat"], "longitude": r["lon"], "gps_accuracy_m": r["accuracy_m"]},
                   "submitted_at_utc": datetime.fromtimestamp(r["created"], tz=timezone.utc).strftime("%Y-%m-%d %H:%M"),
                   "device_capture_time": r["client_time"]},
        "checks_run_by_backend": checks,
        "rule_based_priority": pr,
        "known_data_gaps": [k for k, v in checks.items() if isinstance(v, dict) and v.get("status") in ("unavailable", "not_covered", "error")],
        "community_data": COMMUNITY_STATEMENT,
    }


def guard_citizen(res: dict[str, Any]) -> dict[str, Any]:
    """Server-side guardrails on the model output."""
    def strs(v: Any, n: int = 8) -> list[str]:
        return [str(x)[:400] for x in v][:n] if isinstance(v, list) else []

    def obj(v: Any, keys: tuple[str, ...]) -> dict[str, str]:
        v = v if isinstance(v, dict) else {}
        return {k: str(v.get(k, ""))[:900] for k in keys}

    out = {
        "photo_observations": strs(res.get("photo_observations")),
        "photo_quality": str(res.get("photo_quality", "unknown"))[:20],
        "photo_matches_reported_category": str(res.get("photo_matches_reported_category", "cannot tell"))[:20],
        "credibility": str(res.get("credibility", "")).upper().strip(),
        "summary": str(res.get("summary", ""))[:700],
        "evidence_for": strs(res.get("evidence_for")), "evidence_against": strs(res.get("evidence_against")),
        "contradictions": strs(res.get("contradictions")), "unknowns": strs(res.get("unknowns")),
        "recommended_action": str(res.get("recommended_action", ""))[:600],
        "officer_alert": obj(res.get("officer_alert"), ("headline", "message_en", "message_ta")),
        "citizen_reply": obj(res.get("citizen_reply"), ("message_en", "message_ta")),
        "legality_note": LEGALITY_NOTE,  # forced: the model does not decide legality
        "confirmed": False,              # forced: a photo cannot confirm anything
        "guard_flags": [],
    }
    if out["credibility"] not in CREDIBILITY:
        out["guard_flags"].append(f"Model credibility '{out['credibility'] or 'missing'}' is not a valid rating; set to INCONCLUSIVE.")
        out["credibility"] = "INCONCLUSIVE"
    text = json.dumps({k: v for k, v in out.items() if k not in ("legality_note", "guard_flags")}, ensure_ascii=False)
    hit = sorted({m.group(0).lower() for m in FLAG_WORDS.finditer(text)})
    if hit:
        out["guard_flags"].append("AI wording used terms about legality or confirmation (" + ", ".join(hit) + "). Treat these as unverified; the system does not determine either.")
    return out


def run_ai(rid: int) -> None:
    r = _row(rid)
    if not r:
        return
    try:
        p = prompts.build_citizen_prompt(ai_facts(r))
        raw = (UPLOAD_DIR / r["photo_file"]).read_bytes()
        parts = [{"text": p["user"]}, {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(raw).decode()}}]
        text = generate(p["system"], [{"role": "user", "parts": parts}], json_mode=True)
        _save_ai(rid, "DONE", guard_citizen(parse_json(text)), None, config.GEMINI_MODEL)
    except GeminiError as e:
        _save_ai(rid, "FAILED", None, str(e))
    except Exception as e:  # noqa: BLE001
        _save_ai(rid, "FAILED", None, f"Unexpected error: {e}")


# ---------------------------------------------------------------- citizen routes
@router.get("/region")
def get_region():
    return {"bbox": region(), "study_area": config.STUDY_AREA}


@router.post("/reports")
async def submit_report(request: Request, background: BackgroundTasks, category: str = Form(...), note: str = Form(""), lat: float = Form(...),
                        lon: float = Form(...), accuracy_m: float | None = Form(None), client_time: str | None = Form(None), photo: UploadFile = File(...)):
    if category not in CATEGORIES:
        raise HTTPException(422, "Category must be fire, deforestation or other.")
    note = note.strip()
    if len(note) > 1000:
        raise HTTPException(422, "Note is longer than 1000 characters.")
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(422, "Location is not valid.")
    rg = region()
    if not (rg["south"] <= lat <= rg["north"] and rg["west"] <= lon <= rg["east"]):
        raise HTTPException(422, f"This location is outside the area TerraPulse covers ({config.STUDY_AREA}).")
    now = time.time()
    with db.conn() as c:
        n = c.execute("SELECT COUNT(*) FROM field_reports WHERE username=? AND created > ?", (request.state.user, now - 3600)).fetchone()[0]
    if n >= MAX_REPORTS_PER_HOUR:
        raise HTTPException(429, f"Report limit reached ({MAX_REPORTS_PER_HOUR} per hour). Please try again later.")
    raw = await photo.read(MAX_UPLOAD_BYTES + 1)
    name, exif = process_photo(raw)
    checks = build_checks(lat, lon, accuracy_m, exif, request.state.user, now)
    pr = priority(category, checks)
    with db.conn() as c:
        cur = c.execute("""INSERT INTO field_reports (username, reporter_name, category, note, lat, lon, accuracy_m, client_time, photo_file, exif, checks,
            priority_score, priority_level, priority_reasons, ai_status, status, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (request.state.user, request.state.name, category, note, lat, lon, accuracy_m, (client_time or "")[:40] or None, name, json.dumps(exif),
                         json.dumps(checks), pr["score"], pr["level"], json.dumps({"reasons": pr["reasons"], "not_triggered": pr["not_triggered"], "rule": pr["rule"]}), "PENDING", "NEW", now, now))
        rid = cur.lastrowid
    background.add_task(run_ai, rid)
    return {"report": citizen_view(_row(rid))}  # type: ignore[arg-type]


@router.get("/reports")
def my_reports(request: Request):
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM field_reports WHERE username=? ORDER BY id DESC", (request.state.user,))]
    return {"reports": [citizen_view(r) for r in rows]}


def _photo_response(r: dict[str, Any] | None):
    if not r or not re.fullmatch(r"[0-9a-f]{32}\.jpg", r["photo_file"]):
        raise HTTPException(404, "Photo not found")
    path = UPLOAD_DIR / r["photo_file"]
    if not path.exists():
        raise HTTPException(404, "Photo not found")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/reports/{rid}/photo")
def my_photo(rid: int, request: Request):
    r = _row(rid)
    if not r or r["username"] != request.state.user:  # a citizen can only see their own photos
        raise HTTPException(404, "Photo not found")
    return _photo_response(r)


# ---------------------------------------------------------------- officer routes
@officer.get("/summary")
def summary():
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT status, priority_level FROM field_reports")]
    open_ = [r for r in rows if r["status"] in ("NEW", "UNDER REVIEW", "NEEDS FIELD VISIT")]
    return {"total": len(rows), "new": sum(1 for r in rows if r["status"] == "NEW"),
            "alerts": sum(1 for r in open_ if r["priority_level"] != "LOW")}


@officer.get("")
def list_reports(status: str | None = None, alerts: bool = False):
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM field_reports")]
    if status:
        rows = [r for r in rows if r["status"] == status]
    if alerts:
        rows = [r for r in rows if r["priority_level"] != "LOW" and r["status"] in ("NEW", "UNDER REVIEW", "NEEDS FIELD VISIT")]
    rows.sort(key=lambda r: (-r["priority_score"], -r["created"]))
    return {"reports": [officer_view(r) for r in rows], "count": len(rows)}


@officer.get("/{rid}")
def get_report(rid: int):
    r = _row(rid)
    if not r:
        raise HTTPException(404, "Report not found")
    return {"report": officer_view(r, full=True)}


@officer.get("/{rid}/photo")
def officer_photo(rid: int):
    return _photo_response(_row(rid))


class ReviewIn(BaseModel):
    status: Literal["NEW", "UNDER REVIEW", "NEEDS FIELD VISIT", "VERIFIED", "FALSE REPORT"]
    notes: str = Field("", max_length=2000)


@officer.post("/{rid}/review")
def review(rid: int, body: ReviewIn, request: Request):
    if not _row(rid):
        raise HTTPException(404, "Report not found")
    with db.conn() as c:
        c.execute("UPDATE field_reports SET status=?, officer_notes=?, reviewed_by=?, updated=? WHERE id=?",
                  (body.status, body.notes.strip(), request.state.user, time.time(), rid))
    return {"report": officer_view(_row(rid), full=True)}  # type: ignore[arg-type]


@officer.post("/{rid}/recheck")
def recheck(rid: int, background: BackgroundTasks):
    if not _row(rid):
        raise HTTPException(404, "Report not found")
    _save_ai(rid, "PENDING")
    background.add_task(run_ai, rid)
    return {"report": officer_view(_row(rid), full=True)}  # type: ignore[arg-type]
