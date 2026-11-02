"""Optional data layers for the website features that need external data.

Nothing here is invented. Each layer reads a file that the project owner generates once (see /tools). While a file
is missing, the layer reports status "unavailable" and the UI shows "Data unavailable in current prototype".

  data/osm_layers.json     settlements, schools, water, roads  (OpenStreetMap, tools/fetch_osm_layers.py)
  data/hansen_loss.csv     Hansen tree-cover-loss pixels       (Earth Engine, tools/ee_change_series.js)
  data/change_series.csv   NDVI/NBR for the same season over several years at the 27 points (Earth Engine)
  data/fire_detections.csv NASA FIRMS archive                  (tools/fetch_firms.py)  -> fire-season + replay events
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd

from . import config

DATA = config.BASE / "data"
OSM_JSON = Path(os.getenv("TERRAPULSE_OSM", DATA / "osm_layers.json"))
HANSEN_CSV = Path(os.getenv("TERRAPULSE_HANSEN", DATA / "hansen_loss.csv"))
CHANGE_CSV = Path(os.getenv("TERRAPULSE_CHANGE", DATA / "change_series.csv"))
UNAVAILABLE = "Data unavailable in current prototype"

# Distance from a point to a polyline is approximated by the nearest vertex; tools/fetch_osm_layers.py densifies roads to ~150 m.
KINDS = ("settlement", "school", "water", "road")
KIND_LABEL = {"settlement": "settlements", "school": "schools", "water": "water sources", "road": "roads"}

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


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(a))


# ------------------------------------------------------------------ OSM layer
def _load_osm(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    feats = []
    for f in raw.get("features", []):
        if f.get("type") not in KINDS:
            continue
        pts = f.get("points") or ([[f["lat"], f["lon"]]] if "lat" in f and "lon" in f else [])
        pts = [(float(a), float(b)) for a, b in pts if a is not None and b is not None]
        if pts:
            feats.append({"type": f["type"], "name": (f.get("name") or "").strip() or None, "points": pts})
    return {"features": feats, "source": raw.get("source", "OpenStreetMap"), "fetched": raw.get("fetched")}


def osm_status() -> dict[str, Any]:
    try:
        d = _cached(OSM_JSON, _load_osm)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": f"OpenStreetMap layer file could not be read: {e}"}
    if d is None:
        return {"status": "unavailable", "message": UNAVAILABLE + " (no OpenStreetMap layer file loaded)"}
    counts = {k: sum(1 for f in d["features"] if f["type"] == k) for k in KINDS}
    return {"status": "ok", "source": d["source"], "fetched": d["fetched"], "counts": counts}


def osm_features() -> list[dict[str, Any]]:
    try:
        d = _cached(OSM_JSON, _load_osm)
    except Exception:  # noqa: BLE001
        return []
    return d["features"] if d else []


def nearby(lat: float, lon: float, radius_km: float = 5.0) -> dict[str, Any]:
    """Settlements, schools, water sources and roads within radius_km of a point (OpenStreetMap, may be incomplete)."""
    st = osm_status()
    if st["status"] != "ok":
        return {"status": st["status"], "message": st["message"], "radius_km": radius_km}
    found: dict[str, list[dict[str, Any]]] = {k: [] for k in KINDS}
    for f in osm_features():
        d = min(haversine_km(lat, lon, a, b) for a, b in f["points"])
        if d <= radius_km:
            found[f["type"]].append({"name": f["name"], "distance_km": round(d, 2)})
    out: dict[str, Any] = {"status": "ok", "radius_km": radius_km, "source": st["source"], "fetched": st["fetched"],
                           "note": "OpenStreetMap coverage in forest areas can be incomplete; counts are a minimum, not a full census."}
    for k in KINDS:
        found[k].sort(key=lambda x: x["distance_km"])
        out[k] = {"count": len(found[k]), "nearest": found[k][:3]}
    out["summary_en"] = impact_summary(out, "en")
    out["summary_ta"] = impact_summary(out, "ta")
    return out


def impact_summary(n: dict[str, Any], lang: str) -> str:
    if n.get("status") != "ok":
        return UNAVAILABLE
    r = f"{n['radius_km']:g}"
    one = {"settlement": "settlement", "school": "school", "water": "water source", "road": "road"}
    parts_en = [f"{n[k]['count']} {one[k] if n[k]['count'] == 1 else KIND_LABEL[k]}" for k in KINDS]
    ta ={"settlement": "குடியிருப்புகள்", "school": "பள்ளிகள்", "water": "நீர் ஆதாரங்கள்", "road": "சாலைகள்"}
    if lang == "ta":
        return f"{r} கி.மீ.க்குள்: " + ", ".join(f"{ta[k]} {n[k]['count']}" for k in KINDS)
    return f"Within {r} km: " + ", ".join(parts_en)


def place_name(lat: float, lon: float) -> str | None:
    """Name of the nearest named settlement within 15 km, if the OSM layer is loaded."""
    best = None
    for f in osm_features():
        if f["type"] != "settlement" or not f["name"]:
            continue
        d = min(haversine_km(lat, lon, a, b) for a, b in f["points"])
        if d <= 15 and (best is None or d < best[0]):
            best = (d, f["name"])
    return best[1] if best else None


# ----------------------------------------------------------------- Hansen loss
def _load_hansen(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    need = {"latitude", "longitude", "lossyear"}
    if not need.issubset(df.columns):
        raise ValueError(f"hansen loss file needs columns {sorted(need)}")
    df["lossyear"] = df["lossyear"].astype(int)
    df.loc[df["lossyear"] < 100, "lossyear"] += 2000  # Hansen stores 1..23 for 2001..2023; accept either form
    return df.dropna(subset=["latitude", "longitude"])


def hansen_check(lat: float, lon: float, radius_km: float = 1.0) -> dict[str, Any]:
    """Hansen tree-cover-loss pixels near a point. Historical, annual, coarse; supporting evidence only."""
    try:
        df = _cached(HANSEN_CSV, _load_hansen)
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "message": f"Tree-cover-loss file could not be read: {e}"}
    if df is None:
        return {"status": "unavailable", "message": UNAVAILABLE + " (no Hansen tree-cover-loss file loaded)"}
    d = df.assign(_km=[haversine_km(lat, lon, a, b) for a, b in zip(df["latitude"], df["longitude"])])
    d = d[d["_km"] <= radius_km]
    years = sorted(int(y) for y in d["lossyear"].unique())
    out: dict[str, Any] = {"status": "ok", "radius_km": radius_km, "loss_pixels": int(len(d)), "loss_years": years,
                           "note": "Hansen/UMD Global Forest Change records annual tree-cover loss from any cause (felling, fire, storms, drought). "
                                   "It is historical supporting evidence, not proof of clearing or of illegality."}
    out["interpretation"] = (f"Hansen recorded tree-cover loss within {radius_km:g} km in {', '.join(map(str, years))}."
                             if len(d) else f"No Hansen tree-cover loss recorded within {radius_km:g} km (Hansen covers 2001 onward and is annual).")
    return out
