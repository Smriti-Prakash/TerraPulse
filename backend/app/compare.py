"""Compare one incident with the other incidents in the evidence file, with citizen reports near it, and with FIRMS fire history.

Everything here is computed from real data. The evidence file has no dates, so "other incidents" means other recorded
incidents, NOT earlier ones in time. Nothing is estimated.
"""
from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException

from . import citizen, config, db, layers
from .core import FEATURES, engine

router = APIRouter(prefix="/api", tags=["compare"])
Z_FEATURES = ["NDVI", "NBR", "VV", "VH", "Fire_Brightness", "Temperature", "Rainfall"]  # Forest is a 0/1 flag, compared separately
REPORT_RADIUS_KM = 5.0
FIRE_RADIUS_KM = 5.0
NOTE = ("The evidence file has no dates, so these are other recorded incidents, not earlier ones in time. "
        "Similarity compares eight measured values; it does not mean the same cause.")


def _row(rec: dict[str, Any], base: dict[str, Any], dist_km: float | None, sim: float | None, states: dict, inv: set[str]) -> dict[str, Any]:
    f, b = rec["features"], base["features"]
    iid = rec["incident_id"]
    return {"incident_id": iid, "distance_km": None if dist_km is None else round(dist_km, 2), "similarity_distance": None if sim is None else round(sim, 2),
            "risk_level": rec["risk"]["level"], "ml_probability": round(rec["ml"]["probability"], 3), "status": states.get(iid, {}).get("status", "NEW"),
            "ai_investigated": iid in inv, "forest": int(f["Forest"]),
            "ndvi": round(f["NDVI"], 4), "nbr": round(f["NBR"], 4), "thermal_k": round(f["Fire_Brightness"], 2),
            "d_ndvi": round(f["NDVI"] - b["NDVI"], 4), "d_nbr": round(f["NBR"] - b["NBR"], 4), "d_thermal_k": round(f["Fire_Brightness"] - b["Fire_Brightness"], 2)}


def _similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    """Mean absolute robust-z difference over the measured values (smaller = more alike)."""
    ds = []
    for k in Z_FEATURES:
        r = engine.ref.get(k)
        if not r:
            continue
        scale = r["mad"] if r.get("mad") else (r["max"] - r["min"]) or 1.0
        ds.append(abs(a["features"][k] - b["features"][k]) / scale)
    return sum(ds) / len(ds) if ds else float("inf")


def _rank(vals: list[float], mine: float, lowest_first: bool) -> int:
    order = sorted(vals, reverse=not lowest_first)
    return order.index(mine) + 1


def _fire_history(lat: float, lon: float) -> dict[str, Any]:
    try:
        df = citizen._cached(citizen.FIRE_CSV, citizen._load_fire)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": str(e)}
    if df is None or df.empty:
        return {"status": "unavailable", "message": layers.UNAVAILABLE + " (no NASA FIRMS file loaded)"}
    d = df[[citizen.haversine_km(lat, lon, a, b) <= FIRE_RADIUS_KM for a, b in zip(df["latitude"], df["longitude"])]]
    lo, hi = df["_dt"].min(), df["_dt"].max()
    by_year = {int(y): int(n) for y, n in d.groupby(d["_dt"].dt.year).size().items()}
    for y in range(lo.year, hi.year + 1):
        by_year.setdefault(y, 0)
    return {"status": "ok", "radius_km": FIRE_RADIUS_KM, "coverage": [f"{lo:%Y-%m-%d}", f"{hi:%Y-%m-%d}"], "total": int(len(d)),
            "by_year": dict(sorted(by_year.items())), "note": "FIRMS detections only; missing detections are not evidence of no fire."}


def compare_incident(rec: dict[str, Any], k: int = 3) -> dict[str, Any]:
    others = [r for r in engine.records if r["incident_id"] and r["incident_id"] != rec["incident_id"] and r["lat"] is not None and r["ml"] and r["risk"]]
    states, inv = db.states(), db.investigated_ids()
    near = sorted(((citizen.haversine_km(rec["lat"], rec["lon"], r["lat"], r["lon"]), r) for r in others), key=lambda x: x[0])[:k]
    sim = sorted(((_similarity(rec, r), r) for r in others), key=lambda x: x[0])[:k]
    all_inc = [r for r in engine.records if r["incident_id"] and r["ml"] and r["risk"]]
    n = len(all_inc)
    f = rec["features"]
    ranks = {
        "ndvi_lowest_rank": _rank([r["features"]["NDVI"] for r in all_inc], f["NDVI"], True),
        "nbr_lowest_rank": _rank([r["features"]["NBR"] for r in all_inc], f["NBR"], True),
        "thermal_highest_rank": _rank([r["features"]["Fire_Brightness"] for r in all_inc], f["Fire_Brightness"], False),
        "probability_highest_rank": _rank([r["ml"]["probability"] for r in all_inc], rec["ml"]["probability"], False),
        "of": n,
    }
    summary = [f"Among the {n} recorded incidents, this one has the {_ord(ranks['ndvi_lowest_rank'])}-lowest NDVI, the {_ord(ranks['nbr_lowest_rank'])}-lowest NBR, "
               f"the {_ord(ranks['thermal_highest_rank'])}-highest thermal brightness and the {_ord(ranks['probability_highest_rank'])}-highest Random Forest probability."]
    same_risk = sum(1 for r in others if r["risk"]["level"] == rec["risk"]["level"])
    summary.append(f"{same_risk} of the other {len(others)} incidents have the same risk level ({rec['risk']['level'].lower()}).")
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT id, category, status, priority_level, lat, lon, created FROM field_reports")]
    reports = sorted(({"report_id": r["id"], "category": r["category"], "status": r["status"], "priority_level": r["priority_level"], "created": r["created"],
                       "distance_km": round(citizen.haversine_km(rec["lat"], rec["lon"], r["lat"], r["lon"]), 2)} for r in rows
                      if citizen.haversine_km(rec["lat"], rec["lon"], r["lat"], r["lon"]) <= REPORT_RADIUS_KM), key=lambda x: x["distance_km"])
    return {"incident_id": rec["incident_id"], "note": NOTE, "ranks": ranks, "summary": summary,
            "nearest": [_row(r, rec, d, None, states, inv) for d, r in near],
            "most_similar": [_row(r, rec, citizen.haversine_km(rec["lat"], rec["lon"], r["lat"], r["lon"]), s, states, inv) for s, r in sim],
            "citizen_reports_nearby": {"radius_km": REPORT_RADIUS_KM, "count": len(reports), "reports": reports[:8]},
            "fire_history": _fire_history(rec["lat"], rec["lon"])}


def _ord(n: int) -> str:
    return "most" if n == 1 else f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def ai_context(c: dict[str, Any]) -> dict[str, Any]:
    """The compact, factual slice of the comparison given to the AI. Only these incident ids may be referred to."""
    keep = lambda rows: [{k: r[k] for k in ("incident_id", "distance_km", "risk_level", "ml_probability", "ndvi", "nbr", "thermal_k", "d_ndvi", "d_nbr", "d_thermal_k", "status")} for r in rows]  # noqa: E731
    return {"note": c["note"], "this_incident_rank_among_all": c["ranks"], "nearest_incidents": keep(c["nearest"]), "most_similar_incidents": keep(c["most_similar"]),
            "citizen_reports_within_5km": c["citizen_reports_nearby"]["count"], "fire_history_5km": c["fire_history"]}


def allowed_ids(c: dict[str, Any]) -> set[str]:
    return {r["incident_id"] for r in c["nearest"] + c["most_similar"]}


@router.get("/incidents/{iid}/compare")
def compare(iid: str):
    if engine.model is None or engine.df is None:
        raise HTTPException(503, "TerraPulse data/model not available")
    rec = engine.get_record(iid)
    if rec is None or not rec["incident_id"]:
        raise HTTPException(404, f"Incident {iid} not found")
    return compare_incident(rec)
