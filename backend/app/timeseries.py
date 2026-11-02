"""Graphs of the forest over months and years, for one place.

Every number comes from a data file the project owner supplies (see layers.py). A metric whose file is missing, or that does
not cover the place or the dates, says so ("Data unavailable in current prototype"); nothing is filled in or estimated.
A natural-language request is turned into chart settings (place, metrics, years) and the settings are validated; the language
model never supplies chart values.

  fire   NASA FIRMS detections within a radius        monthly or yearly   data/fire_detections.csv
  ndvi   Landsat NDVI, same season every year          yearly              data/change_series.csv
  nbr    Landsat NBR, same season every year           yearly              data/change_series.csv
  rain   CHIRPS rainfall in that season                yearly              data/change_series.csv
  ndvi / nbr / rain monthly (optional)                 monthly             data/monthly_series.csv  (tools/ee_monthly_series.js)
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import citizen, config, layers
from .core import engine
from .gemini import GeminiError, generate, parse_json
from .insights import _load_change, analyse

router = APIRouter(prefix="/api", tags=["timeseries"])
MONTHLY_CSV = Path(os.getenv("TERRAPULSE_MONTHLY", layers.DATA / "monthly_series.csv"))
MAX_SERIES_KM = float(os.getenv("TERRAPULSE_SERIES_MAX_KM", "2.0"))
METRICS = ("fire", "ndvi", "nbr", "rain")
LABEL = {"fire": "Fire detections", "ndvi": "NDVI (greenness)", "nbr": "NBR (burn / moisture)", "rain": "Rainfall"}
UNIT = {"fire": "detections", "ndvi": "index", "nbr": "index", "rain": "mm"}


def _load_monthly(path):
    df = pd.read_csv(path)
    need = {"point_id", "latitude", "longitude", "month"}
    if not need.issubset(df.columns):
        raise ValueError(f"monthly-series file needs columns {sorted(need)}")
    df["month"] = df["month"].astype(str).str.slice(0, 7)
    return df


def _period(s: str | None, end: bool) -> pd.Period | None:
    if not s:
        return None
    s = str(s).strip()
    try:
        if re.fullmatch(r"\d{4}", s):
            return pd.Period(f"{s}-12" if end else f"{s}-01", "M")
        return pd.Period(s[:7], "M")
    except Exception:  # noqa: BLE001
        raise HTTPException(400, f"'{s}' is not a year (2022) or a month (2022-03)")


def _nearest_point(df: pd.DataFrame, lat: float, lon: float) -> tuple[str | None, float | None]:
    pts = df.drop_duplicates("point_id")[["point_id", "latitude", "longitude"]]
    best = min(((citizen.haversine_km(lat, lon, a, b), str(p)) for p, a, b in zip(pts["point_id"], pts["latitude"], pts["longitude"])), default=None)
    return (best[1], round(best[0], 2)) if best else (None, None)


def _missing(metric: str, status: str, message: str, source: str) -> dict[str, Any]:
    return {"metric": metric, "label": LABEL[metric], "unit": UNIT[metric], "status": status, "message": message, "points": [], "source": source}


def _fire_series(lat: float, lon: float, radius: float, gran: str, a: pd.Period | None, b: pd.Period | None) -> dict[str, Any]:
    src = "NASA FIRMS satellite fire detections"
    try:
        df = citizen._cached(citizen.FIRE_CSV, citizen._load_fire)
    except Exception as e:  # noqa: BLE001
        return _missing("fire", "error", f"Fire file could not be read: {e}", src)
    if df is None or df.empty:
        return _missing("fire", "unavailable", layers.UNAVAILABLE + " (no NASA FIRMS file loaded; run tools/fetch_firms.py)", src)
    lo, hi = df["_dt"].min(), df["_dt"].max()
    cov_a, cov_b = pd.Period(lo.strftime("%Y-%m"), "M"), pd.Period(hi.strftime("%Y-%m"), "M")
    start, end = max(a or cov_a, cov_a), min(b or cov_b, cov_b)
    if start > end:
        return _missing("fire", "not_covered", f"The fire file covers {lo:%Y-%m-%d} to {hi:%Y-%m-%d}; it does not cover the dates asked for.", src)
    d = df[[citizen.haversine_km(lat, lon, x, y) <= radius for x, y in zip(df["latitude"], df["longitude"])]]
    counts = d.groupby(d["_dt"].dt.strftime("%Y-%m")).size().to_dict()
    pts = []
    if gran == "month":
        for p in pd.period_range(start, end, freq="M"):
            pts.append({"t": str(p), "v": int(counts.get(str(p), 0))})
    else:
        for y in range(start.year, end.year + 1):
            pts.append({"t": str(y), "v": int(sum(n for k, n in counts.items() if k.startswith(str(y))))})
    partial = (start.month != 1 and gran == "year") or (end.month != 12 and gran == "year")
    note = "A missing detection is not evidence of no fire: satellites miss small, short or cloud-covered fires."
    if partial:
        note += " The first or last year is only part of a year in the file."
    return {"metric": "fire", "label": f"{LABEL['fire']} within {radius:g} km", "unit": UNIT["fire"], "status": "ok", "points": pts, "source": src,
            "coverage": [f"{lo:%Y-%m-%d}", f"{hi:%Y-%m-%d}"], "note": note}


def _annual_series(metrics: list[str], lat: float, lon: float, a: pd.Period | None, b: pd.Period | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    src = "Landsat via Google Earth Engine, same seasonal window each year"
    extra: dict[str, Any] = {}
    try:
        df = citizen._cached(layers.CHANGE_CSV, _load_change)
    except Exception as e:  # noqa: BLE001
        return [_missing(m, "error", f"Change file could not be read: {e}", src) for m in metrics], extra
    if df is None:
        return [_missing(m, "unavailable", layers.UNAVAILABLE + " (no multi-year vegetation file loaded; see tools/ee_change_series.js)", src) for m in metrics], extra
    pid, km = _nearest_point(df, lat, lon)
    extra["series_point"] = {"point_id": pid, "distance_km": km}
    if pid is None or km is None or km > MAX_SERIES_KM:
        msg = f"The nearest vegetation-series point is {km} km away (limit {MAX_SERIES_KM:g} km), so no yearly series is shown for this place."
        return [_missing(m, "not_covered", msg, src) for m in metrics], extra
    g = df[df["point_id"].astype(str) == pid].sort_values("year")
    if a:
        g = g[g["year"] >= a.year]
    if b:
        g = g[g["year"] <= b.year]
    col = {"ndvi": "ndvi", "nbr": "nbr", "rain": "rain_mm"}
    win = str(g["window"].iloc[0]) if "window" in g.columns and len(g) else None
    out = []
    for m in metrics:
        if col[m] not in g.columns:
            out.append(_missing(m, "unavailable", layers.UNAVAILABLE + f" (the change file has no {col[m]} column)", src)); continue
        pts = [{"t": str(int(y)), "v": None if pd.isna(v) else round(float(v), 4)} for y, v in zip(g["year"], g[col[m]])]
        out.append({"metric": m, "label": LABEL[m], "unit": UNIT[m], "status": "ok" if pts else "not_covered", "points": pts, "source": src, "window": win,
                    "message": None if pts else "No years in the file fall inside the dates asked for.",
                    "note": f"One value per year for the same months each year ({win or 'window not recorded'}), so the season itself does not look like a change."})
    # flagged years use the same transparent rule as the Change Over Time page
    try:
        res = analyse(df[df["point_id"].astype(str) == pid])
        extra["flag_years"] = [e["year"] for p in res["points"] for e in p["events"]]
    except Exception:  # noqa: BLE001
        extra["flag_years"] = []
    return out, extra


def _monthly_series(metrics: list[str], lat: float, lon: float, a: pd.Period | None, b: pd.Period | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    src = "Landsat / CHIRPS monthly values via Google Earth Engine"
    extra: dict[str, Any] = {}
    try:
        df = citizen._cached(MONTHLY_CSV, _load_monthly)
    except Exception as e:  # noqa: BLE001
        return [_missing(m, "error", f"Monthly file could not be read: {e}", src) for m in metrics], extra
    if df is None:
        return [_missing(m, "unavailable", layers.UNAVAILABLE + " (no monthly vegetation file loaded; run tools/ee_monthly_series.js)", src) for m in metrics], extra
    pid, km = _nearest_point(df, lat, lon)
    extra["series_point"] = {"point_id": pid, "distance_km": km}
    if pid is None or km is None or km > MAX_SERIES_KM:
        return [_missing(m, "not_covered", f"The nearest monthly-series point is {km} km away (limit {MAX_SERIES_KM:g} km).", src) for m in metrics], extra
    g = df[df["point_id"].astype(str) == pid].sort_values("month")
    if a:
        g = g[g["month"] >= str(a)]
    if b:
        g = g[g["month"] <= str(b)]
    col = {"ndvi": "ndvi", "nbr": "nbr", "rain": "rain_mm"}
    out = []
    for m in metrics:
        if col[m] not in g.columns:
            out.append(_missing(m, "unavailable", layers.UNAVAILABLE + f" (the monthly file has no {col[m]} column)", src)); continue
        pts = [{"t": mo, "v": None if pd.isna(v) else round(float(v), 4)} for mo, v in zip(g["month"], g[col[m]])]
        out.append({"metric": m, "label": LABEL[m], "unit": UNIT[m], "status": "ok" if pts else "not_covered", "points": pts, "source": src,
                    "message": None if pts else "No months in the file fall inside the dates asked for.",
                    "note": "Months with heavy cloud have no value (gaps are left blank, never filled in). Seasons change NDVI and NBR, so compare the same months across years."})
    return out, extra


def build(lat: float, lon: float, metrics: list[str], gran: str, start: str | None, end: str | None, radius: float, label: str | None = None) -> dict[str, Any]:
    a, b = _period(start, False), _period(end, True)
    if a and b and a > b:
        raise HTTPException(400, "The start date is after the end date")
    metrics = [m for m in METRICS if m in metrics] or list(METRICS)
    series: list[dict[str, Any]] = []
    extra: dict[str, Any] = {}
    if "fire" in metrics:
        series.append(_fire_series(lat, lon, radius, gran, a, b))
    veg = [m for m in metrics if m != "fire"]
    if veg:
        s, extra = (_monthly_series if gran == "month" else _annual_series)(veg, lat, lon, a, b)
        series += s
    hansen = layers.hansen_check(lat, lon, 1.0)
    return {"place": {"lat": lat, "lon": lon, "label": label}, "granularity": gran, "radius_km": radius, "range": {"start": start, "end": end},
            "series": series, "series_point": extra.get("series_point"), "flag_years": extra.get("flag_years", []),
            "hansen": {"status": hansen["status"], "loss_years": hansen.get("loss_years", []), "message": hansen.get("message")},
            "note": "Real data only. A flagged year means potential vegetation disturbance, not a confirmed cause."}


def _region_check(lat: float, lon: float) -> None:
    b = citizen.region()
    if not (b["south"] <= lat <= b["north"] and b["west"] <= lon <= b["east"]):
        raise HTTPException(400, "That place is outside the area TerraPulse covers (Mudumalai)")


@router.get("/timeseries")
def timeseries(lat: float, lon: float, metrics: str = "fire,ndvi,nbr,rain", granularity: str = "year", start: str | None = None, end: str | None = None,
               radius_km: float = 2.0, label: str | None = None):
    if granularity not in ("month", "year"):
        raise HTTPException(400, "granularity must be month or year")
    if not 0.2 <= radius_km <= 10:
        raise HTTPException(400, "radius_km must be between 0.2 and 10")
    _region_check(lat, lon)
    return build(lat, lon, [m.strip() for m in metrics.split(",") if m.strip() in METRICS], granularity, start, end, radius_km, label)


# ---------------------------------------------------------------- ask for a graph
class AskIn(BaseModel):
    text: str = Field(min_length=3, max_length=400)


def _coverage_text() -> str:
    parts = []
    try:
        df = citizen._cached(citizen.FIRE_CSV, citizen._load_fire)
        parts.append(f"fire detections {df['_dt'].min():%Y-%m} to {df['_dt'].max():%Y-%m}" if df is not None else "fire detections: not loaded")
    except Exception:  # noqa: BLE001
        parts.append("fire detections: not loaded")
    try:
        ch = citizen._cached(layers.CHANGE_CSV, _load_change)
        parts.append(f"yearly vegetation {int(ch['year'].min())} to {int(ch['year'].max())}" if ch is not None else "yearly vegetation: not loaded")
    except Exception:  # noqa: BLE001
        parts.append("yearly vegetation: not loaded")
    try:
        mo = citizen._cached(MONTHLY_CSV, _load_monthly)
        parts.append(f"monthly vegetation {mo['month'].min()} to {mo['month'].max()}" if mo is not None else "monthly vegetation: not loaded")
    except Exception:  # noqa: BLE001
        parts.append("monthly vegetation: not loaded")
    return "; ".join(parts)


SYSTEM = ("You turn a forest officer's request for a graph into chart settings. You do NOT produce any data values. "
          "Return JSON only with keys: incident_id (string like TP-001 or null), lat (number or null), lon (number or null), "
          "metrics (array of: fire, ndvi, nbr, rain), granularity ('month' or 'year'), start (YYYY or YYYY-MM or null), end (YYYY or YYYY-MM or null), "
          "radius_km (number 0.5 to 10, default 2). Use incident_id when the officer names an incident; use lat/lon only when coordinates are given. "
          "'greenness', 'vegetation' or 'forest health' means ndvi and nbr; 'burn' means nbr; 'fire' or 'hotspot' means fire; 'rain' or 'rainfall' means rain. "
          "'by month', 'monthly' or 'over the months' means month; otherwise year. If no metric is named use fire, ndvi, nbr.")


def _simple_parse(text: str) -> dict[str, Any]:
    """Rule-based reading of a request, used when the language model is not available."""
    t = text.lower()
    m = re.search(r"tp-?\s?(\d{1,3})", t)
    inc = f"TP-{int(m.group(1)):03d}" if m else None
    mets = [k for k, words in (("fire", ("fire", "hotspot", "burn event", "thermal")), ("ndvi", ("ndvi", "green", "vegetation", "forest health", "canopy")),
                               ("nbr", ("nbr", "burn", "moisture", "vegetation", "forest health")), ("rain", ("rain", "precip"))) if any(w in t for w in words)]
    years = re.findall(r"\b(20\d{2})\b", t)
    gran = "month" if re.search(r"month", t) else "year"
    ll = re.search(r"(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{2,3}\.\d+)", t)
    return {"incident_id": inc, "lat": float(ll.group(1)) if ll else None, "lon": float(ll.group(2)) if ll else None, "metrics": mets or ["fire", "ndvi", "nbr"],
            "granularity": gran, "start": years[0] if years else None, "end": years[-1] if years else None, "radius_km": 2.0}


def _validate(p: dict[str, Any]) -> dict[str, Any]:
    mets = [m for m in (p.get("metrics") or []) if m in METRICS] or ["fire", "ndvi", "nbr"]
    gran = p.get("granularity") if p.get("granularity") in ("month", "year") else "year"
    try:
        radius = min(10.0, max(0.5, float(p.get("radius_km") or 2.0)))
    except (TypeError, ValueError):
        radius = 2.0
    for k in ("start", "end"):
        v = p.get(k)
        p[k] = str(v) if v and re.fullmatch(r"\d{4}(-\d{2})?", str(v)) else None
    return {**p, "metrics": mets, "granularity": gran, "radius_km": radius}


@router.post("/timeseries/ask")
def ask(body: AskIn, request: Request):
    if engine.model is None or engine.df is None:
        raise HTTPException(503, "TerraPulse data not available")
    how = "AI read the request"
    try:
        user = f"Data available: {_coverage_text()}.\nOfficer's request: {body.text.strip()}"
        params = parse_json(generate(SYSTEM, [{"role": "user", "parts": [{"text": user}]}], json_mode=True, temperature=0.0))
        if not isinstance(params, dict):
            raise GeminiError("unexpected AI reply", 502)
    except GeminiError:
        params, how = _simple_parse(body.text), "Read with simple rules (the AI is not available right now)"
    p = _validate(params)
    lat, lon, label = p.get("lat"), p.get("lon"), None
    iid = p.get("incident_id")
    if iid:
        rec = engine.get_record(str(iid).upper())
        if rec is None or not rec["incident_id"]:
            raise HTTPException(404, f"I could not find incident {iid}. Name an existing incident (for example TP-001) or give coordinates.")
        lat, lon, label = rec["lat"], rec["lon"], rec["incident_id"]
    if lat is None or lon is None:
        raise HTTPException(400, "Say which place: an incident such as TP-001, or coordinates such as 11.6480, 76.4985.")
    _region_check(float(lat), float(lon))
    out = build(float(lat), float(lon), p["metrics"], p["granularity"], p["start"], p["end"], p["radius_km"], label)
    span = f"{p['start'] or 'start of the data'} to {p['end'] or 'end of the data'}"
    out["interpreted_as"] = (f"{', '.join(LABEL[m] for m in p['metrics'])} · {'by month' if p['granularity'] == 'month' else 'by year'} · "
                             f"{label or f'{lat:.4f}, {lon:.4f}'} · {span}")
    out["how"] = how
    return out
