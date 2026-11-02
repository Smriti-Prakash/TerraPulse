"""Change Over Time, historical fire-season planning and FIRMS replay events.

Every function reads a user-supplied data file (see layers.py). When the file is missing the result says so; nothing is
estimated. The SIMULATION series at the bottom is clearly labelled and is never mixed with real data.
"""
from __future__ import annotations

import os
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException

from . import layers
from .citizen import FIRE_CSV, _cached, _load_fire, haversine_km

router = APIRouter(prefix="/api", tags=["insights"])

NDVI_DROP = float(os.getenv("TERRAPULSE_CHANGE_NDVI_DROP", "0.10"))
NBR_DROP = float(os.getenv("TERRAPULSE_CHANGE_NBR_DROP", "0.10"))
DRY_RATIO = float(os.getenv("TERRAPULSE_CHANGE_DRY_RATIO", "0.70"))   # rainfall below 70% of earlier years = shortfall
FIRE_RADIUS_KM = 1.5
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

RULE = {
    "summary": "Compare each year's NDVI and NBR with the same point's average over the earlier years, for the SAME seasonal window.",
    "flag": f"A year is flagged as potential vegetation disturbance when NDVI or NBR is at least {NDVI_DROP:g} / {NBR_DROP:g} below that baseline.",
    "cross_checks": ["NASA FIRMS fire detections within 1.5 km during the window", f"Rainfall below {DRY_RATIO:.0%} of the earlier years' average",
                     "Hansen tree-cover loss recorded in that year (retrospective, supporting only)"],
    "caution": "The thresholds are transparent screening values, not validated limits. A flag means potential vegetation disturbance. "
               "It does not identify the cause, and it does not show clearing or illegality; an officer verifies permits, records and the boundary.",
}


def _window_months(w: Any) -> tuple[int, int] | None:
    try:
        a, b = str(w).split("-")
        a, b = int(a), int(b)
        return (a, b) if 1 <= a <= 12 and 1 <= b <= 12 else None
    except Exception:  # noqa: BLE001
        return None


def _fire_in_window(lat: float, lon: float, year: int, win: tuple[int, int] | None) -> dict[str, Any]:
    try:
        df = _cached(FIRE_CSV, _load_fire)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": str(e)}
    if df is None or df.empty:
        return {"status": "unavailable", "message": layers.UNAVAILABLE + " (no FIRMS file loaded)"}
    if win is None:
        return {"status": "unavailable", "message": "The change file has no seasonal window, so fire cannot be cross-checked."}
    lo, hi = df["_dt"].min(), df["_dt"].max()
    start = pd.Timestamp(year=year, month=win[0], day=1, tz="UTC")
    end = (pd.Timestamp(year=year, month=win[1], day=1, tz="UTC") + pd.offsets.MonthEnd(1)) + pd.Timedelta(days=1)
    if start < lo.normalize() or end > hi.normalize() + pd.Timedelta(days=2):
        return {"status": "not_covered", "message": f"FIRMS file covers {lo:%Y-%m-%d} to {hi:%Y-%m-%d}; it does not cover this window."}
    d = df[(df["_dt"] >= start) & (df["_dt"] < end)]
    n = int(sum(haversine_km(lat, lon, a, b) <= FIRE_RADIUS_KM for a, b in zip(d["latitude"], d["longitude"])))
    return {"status": "ok", "detections": n}


def _load_change(path):
    df = pd.read_csv(path)
    need = {"point_id", "latitude", "longitude", "year", "ndvi", "nbr"}
    if not need.issubset(df.columns):
        raise ValueError(f"change-series file needs columns {sorted(need)}")
    return df


def analyse(df: pd.DataFrame, use_fire_file: bool = True) -> dict[str, Any]:
    """Apply the transparent change rule to a long table (one row per point and year)."""
    points = []
    for pid, g in df.groupby("point_id", sort=True):
        g = g.sort_values("year")
        lat, lon = float(g["latitude"].iloc[0]), float(g["longitude"].iloc[0])
        win = _window_months(g["window"].iloc[0]) if "window" in g.columns else None
        series, events, flagged_years = [], [], set()
        for _, r in g.iterrows():
            y = int(r["year"])
            prev_all = g[g["year"] < y]
            prev = prev_all[~prev_all["year"].isin(flagged_years)]  # the baseline never includes years already flagged
            if prev.empty:
                prev = prev_all
            row: dict[str, Any] = {"year": y, "ndvi": _f(r["ndvi"]), "nbr": _f(r["nbr"]), "rain_mm": _f(r["rain_mm"]) if "rain_mm" in g.columns else None}
            series.append(row)
            if prev.empty or row["ndvi"] is None or row["nbr"] is None:
                continue
            base_ndvi, base_nbr = float(prev["ndvi"].mean()), float(prev["nbr"].mean())
            d_ndvi, d_nbr = row["ndvi"] - base_ndvi, row["nbr"] - base_nbr
            row.update({"baseline_ndvi": round(base_ndvi, 4), "baseline_nbr": round(base_nbr, 4), "d_ndvi": round(d_ndvi, 4), "d_nbr": round(d_nbr, 4)})
            if not (d_ndvi <= -NDVI_DROP or d_nbr <= -NBR_DROP):
                continue
            flagged_years.add(y)
            if (y - 1) in flagged_years:  # still below the pre-disturbance baseline: not a new event
                row["flag_persists"] = True
                continue
            fire = _fire_in_window(lat, lon, y, win) if use_fire_file else {"status": "unavailable", "message": layers.UNAVAILABLE}
            rain_note, dry = None, False
            if row["rain_mm"] is not None and "rain_mm" in prev.columns and prev["rain_mm"].notna().any():
                base_rain = float(prev["rain_mm"].mean())
                if base_rain > 0:
                    dry = row["rain_mm"] <= DRY_RATIO * base_rain
                    rain_note = f"Window rainfall {row['rain_mm']:.0f} mm vs {base_rain:.0f} mm average in earlier years."
            hansen = None
            if "hansen_loss_year" in g.columns and pd.notna(r["hansen_loss_year"]) and int(r["hansen_loss_year"]) > 0:
                hy = int(r["hansen_loss_year"]); hy += 2000 if hy < 100 else 0
                hansen = hy
            hansen_here = hansen == y
            if fire["status"] == "ok" and fire["detections"] > 0:
                reading = f"{fire['detections']} FIRMS detection(s) within {FIRE_RADIUS_KM:g} km in this window: a fire-related decline is possible."
            elif dry:
                reading = "No fire detection in the supplied file, but rainfall was well below earlier years: a dry-season effect is possible."
            else:
                reading = ("No fire detection or rainfall shortfall found in the supplied data. The cause is not determined. "
                           "An officer should check permits, records and the boundary on the ground.")
            events.append({"year": y, "d_ndvi": row["d_ndvi"], "d_nbr": row["d_nbr"], "fire": fire, "rain_note": rain_note, "dry_season": dry,
                           "hansen_loss_year": hansen, "hansen_matches_year": hansen_here,
                           "label": "Potential vegetation disturbance", "reading": reading,
                           "hansen_note": ("Hansen also recorded tree-cover loss at this point in this year (retrospective supporting evidence)." if hansen_here else None)})
            row["flag"] = True
        points.append({"point_id": str(pid), "lat": lat, "lon": lon, "window": (str(g["window"].iloc[0]) if "window" in g.columns else None),
                       "series": series, "events": events})
    flagged = [p for p in points if p["events"]]
    return {"points": points, "summary": {"points": len(points), "flagged_points": len(flagged), "flag_events": sum(len(p["events"]) for p in points),
                                         "years": sorted({int(y) for y in df["year"].unique()})}, "rule": RULE}


def _f(v: Any) -> float | None:
    try:
        x = float(v)
        return None if x != x else round(x, 4)
    except (TypeError, ValueError):
        return None


@router.get("/change")
def change_real():
    try:
        df = layers._cached(layers.CHANGE_CSV, _load_change)
    except Exception as e:  # noqa: BLE001
        return {"mode": "HISTORICAL", "status": "error", "message": f"Change-series file could not be read: {e}", "rule": RULE}
    if df is None:
        return {"mode": "HISTORICAL", "status": "unavailable", "message": layers.UNAVAILABLE + " (no change-series file loaded; run tools/ee_change_series.js and save the CSV as backend/data/change_series.csv)", "rule": RULE}
    return {"mode": "HISTORICAL", "status": "ok", "source": "Landsat surface reflectance, same seasonal window each year (Earth Engine export)", **analyse(df)}


# Illustrative patterns for the presentation. NOT measurements: values are typed in here to show how the rule reads each case.
_SIM = [  # point, year, ndvi, nbr, rain, hansen
    ("SIM-A", 2019, .71, .62, 120, 0), ("SIM-A", 2020, .70, .61, 112, 0), ("SIM-A", 2021, .71, .62, 118, 0), ("SIM-A", 2022, .69, .60, 115, 0), ("SIM-A", 2023, .42, .33, 119, 0),
    ("SIM-B", 2019, .68, .59, 95, 0), ("SIM-B", 2020, .69, .60, 99, 0), ("SIM-B", 2021, .67, .58, 92, 0), ("SIM-B", 2022, .68, .59, 97, 0), ("SIM-B", 2023, .39, .21, 94, 0),
    ("SIM-C", 2019, .72, .63, 110, 0), ("SIM-C", 2020, .71, .62, 108, 0), ("SIM-C", 2021, .72, .63, 112, 0), ("SIM-C", 2022, .70, .61, 109, 0), ("SIM-C", 2023, .55, .47, 38, 0),
]
SIM_NAMES = {"SIM-A": "Sudden loss; no fire; normal rainfall", "SIM-B": "Sudden loss; fire detections in the window", "SIM-C": "Decline in a very dry window; no fire"}


@router.get("/change/simulation")
def change_simulation():
    df = pd.DataFrame(_SIM, columns=["point_id", "year", "ndvi", "nbr", "rain_mm", "hansen_loss_year"])
    df["latitude"], df["longitude"], df["window"] = 11.60, 76.55, "01-03"
    res = analyse(df, use_fire_file=False)
    for p in res["points"]:
        p["name"] = SIM_NAMES[p["point_id"]]
        for e in p["events"]:
            if p["point_id"] == "SIM-B":  # scripted fire evidence for the illustration only
                e["fire"] = {"status": "ok", "detections": 6}
                e["reading"] = "6 FIRMS detection(s) within 1.5 km in this window: a fire-related decline is possible."
            else:
                e["fire"] = {"status": "ok", "detections": 0}
    return {"mode": "SIMULATION", "status": "ok", "source": "Illustrative values typed into the code to demonstrate the rule. These are NOT measurements and are not Mudumalai data.", **res}


# ---------------------------------------------------------------- fire season
def _fire_df() -> pd.DataFrame | None:
    return _cached(FIRE_CSV, _load_fire)


@router.get("/fire-season")
def fire_season():
    try:
        df = _fire_df()
    except Exception as e:  # noqa: BLE001
        return {"mode": "HISTORICAL", "status": "error", "message": f"Fire-detection file could not be read: {e}"}
    if df is None or df.empty:
        return {"mode": "HISTORICAL", "status": "unavailable", "message": layers.UNAVAILABLE + " (no NASA FIRMS archive loaded; run tools/fetch_firms.py)"}
    lo, hi = df["_dt"].min(), df["_dt"].max()
    years = sorted({int(y) for y in df["_dt"].dt.year.unique()})
    monthly = [int((df["_dt"].dt.month == m).sum()) for m in range(1, 13)]
    total = sum(monthly)
    by_year = {str(y): [int(((df["_dt"].dt.year == y) & (df["_dt"].dt.month == m)).sum()) for m in range(1, 13)] for y in years}
    cell = 0.05
    g = df.assign(_la=(df["latitude"] / cell).round().astype(int), _lo=(df["longitude"] / cell).round().astype(int))
    cells = []
    for (a, b), x in g.groupby(["_la", "_lo"]):
        mm = x["_dt"].dt.month.value_counts()
        cells.append({"lat": round(a * cell, 3), "lon": round(b * cell, 3), "detections": int(len(x)), "peak_months": [MONTHS[int(m) - 1] for m in mm.index[:2]],
                      "years_with_detections": int(x["_dt"].dt.year.nunique())})
    cells.sort(key=lambda c: -c["detections"])
    order = sorted(range(12), key=lambda i: -monthly[i])
    watch = [MONTHS[i] for i in order[:3] if monthly[i] > 0]
    return {"mode": "HISTORICAL", "status": "ok", "coverage": [f"{lo:%Y-%m-%d}", f"{hi:%Y-%m-%d}"], "years": years, "total_detections": total,
            "monthly": monthly, "months": MONTHS, "by_year": by_year, "hotspots": cells[:12], "watch_months": watch,
            "reliability": ("Pattern from at least 3 years of archive." if len(years) >= 3 else f"Only {len(years)} year(s) of archive: the seasonal pattern is weak. Load a longer FIRMS archive."),
            "caution": "Historical satellite hot-spot counts. They show where and when fire detections were recorded in the past. This is planning information, not a live prediction, and says nothing about whether a fire is burning now. Satellites miss small or short fires and clouded areas."}


@router.get("/replay/fire-events")
def replay_events():
    """Real FIRMS detections grouped by day, for the officer REPLAY / TEST mode."""
    try:
        df = _fire_df()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Fire-detection file could not be read: {e}")
    if df is None or df.empty:
        return {"status": "unavailable", "message": layers.UNAVAILABLE + " (no NASA FIRMS archive loaded; run tools/fetch_firms.py)", "events": []}
    d = df.assign(_day=df["_dt"].dt.strftime("%Y-%m-%d"))
    events = []
    for day, x in d.groupby("_day"):
        x = x.sort_values("_dt")
        first = x.iloc[0]
        events.append({"date": day, "detections": int(len(x)), "lat": round(float(first["latitude"]), 5), "lon": round(float(first["longitude"]), 5),
                       "detected_utc": f"{first['_dt']:%Y-%m-%d %H:%M}", "confidence": str(first["confidence"]) if "confidence" in x.columns else None})
    events.sort(key=lambda e: (-e["detections"], e["date"]))
    return {"status": "ok", "mode": "REPLAY", "events": events[:40],
            "note": "Real NASA FIRMS detections from the loaded archive. Replay treats one of them as if a citizen had reported smoke there shortly afterwards. Nothing here is live."}


# ------------------------------------------------------------ replay / layers
from datetime import datetime, timezone  # noqa: E402
from typing import Literal  # noqa: E402

from fastapi import Request  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import citizen  # noqa: E402


class ReplayIn(BaseModel):
    lat: float
    lon: float
    at: str                      # ISO time of the REPLAYED report, e.g. 2024-03-04T07:30:00Z
    category: Literal["fire", "deforestation", "other"] = "fire"


@router.post("/replay/report-check")
def replay_report_check(body: ReplayIn, request: Request):
    """REPLAY / TEST: run the normal citizen-report checks as if a report had arrived at a past time. Nothing is stored."""
    try:
        t = datetime.fromisoformat(body.at.replace("Z", "+00:00"))
        t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(422, "Replay time must be an ISO date-time such as 2024-03-04T07:30:00Z.")
    rg = citizen.region()
    if not (rg["south"] <= body.lat <= rg["north"] and rg["west"] <= body.lon <= rg["east"]):
        raise HTTPException(422, "This location is outside the area TerraPulse covers.")
    exif = {"has_exif": False, "exif_time": None, "exif_gps": None}
    checks = citizen.build_checks(body.lat, body.lon, None, exif, request.state.user, t.timestamp())
    checks["other_reports_nearby"] = {"distinct_other_reporters": 0, "radius_m": 500, "window_hours": 24}  # live reports do not apply to a past time
    pr = citizen.priority(body.category, checks)
    return {"mode": "REPLAY", "label": "REPLAY / TEST. A past real FIRMS event, not a live report. No report was stored.",
            "at": t.strftime("%Y-%m-%d %H:%M UTC"), "lat": body.lat, "lon": body.lon, "category": body.category,
            "checks": checks, "priority": pr, "checklist": citizen.verification_checklist(body.category, checks)}


@router.get("/layers/status")
def layers_status():
    def f(p, label):
        return {"label": label, "file": p.name, "loaded": p.exists()}
    return {"layers": [f(citizen.FIRE_CSV, "NASA FIRMS fire detections (fire cross-check, fire season, replay)"),
                       f(citizen.BOUNDARY_GEOJSON, "Reserve boundary"),
                       f(layers.OSM_JSON, "OpenStreetMap settlements, roads, schools, water"),
                       f(layers.HANSEN_CSV, "Hansen tree-cover loss"),
                       f(layers.CHANGE_CSV, "Seasonal NDVI/NBR change series")],
            "osm": layers.osm_status()}


@router.get("/nearby")
def nearby(lat: float, lon: float, radius_km: float = 5.0):
    if not (0 < radius_km <= 25):
        raise HTTPException(422, "radius_km must be between 0 and 25")
    return layers.nearby(lat, lon, radius_km)


@router.get("/osm/features")
def osm_features(kind: str | None = None):
    """Map overlay: OpenStreetMap features (first vertex only for roads)."""
    st = layers.osm_status()
    if st["status"] != "ok":
        return {**st, "features": []}
    out = [{"type": f["type"], "name": f["name"], "lat": f["points"][0][0], "lon": f["points"][0][1]}
           for f in layers.osm_features() if f["type"] != "road" and (kind is None or f["type"] == kind)]
    return {**st, "features": out[:2000]}
