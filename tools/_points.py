"""Shared helper: read the 27 sampled points (and the study-area box) from the evidence CSV."""
import csv, json, pathlib

CSV = pathlib.Path(__file__).resolve().parent.parent / "backend" / "data" / "TerraPulse_Forest_Disturbance_Evidence.csv"
MARGIN = 0.10  # same margin the backend uses for the study-area box


def points():
    out = []
    with open(CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lon, lat = json.loads(r[".geo"])["coordinates"][:2]
            out.append({"id": r["system:index"], "lat": lat, "lon": lon})
    return out


def bbox():
    p = points()
    return (min(x["lon"] for x in p) - MARGIN, min(x["lat"] for x in p) - MARGIN, max(x["lon"] for x in p) + MARGIN, max(x["lat"] for x in p) + MARGIN)  # west, south, east, north
