"""Download settlements, schools, water sources and roads for the TerraPulse study area from OpenStreetMap (Overpass API).

Run once on a computer with internet access:
    python tools/fetch_osm_layers.py
Output: backend/data/osm_layers.json  (the backend picks it up automatically; restart is not needed)

OpenStreetMap is volunteer-mapped, so forest areas can be incomplete. TerraPulse always says so next to the numbers.
"""
import json, math, pathlib, sys, urllib.parse, urllib.request
from datetime import date
from _points import bbox

OUT = pathlib.Path(__file__).resolve().parent.parent / "backend" / "data" / "osm_layers.json"
URL = "https://overpass-api.de/api/interpreter"
ROAD = "primary|secondary|tertiary|unclassified|residential|track|service"


def query(b):
    w, s, e, n = b
    bb = f"{s},{w},{n},{e}"
    return f"""[out:json][timeout:180];
(
  node["place"~"^(village|hamlet|town|suburb|isolated_dwelling)$"]({bb});
  node["amenity"~"^(school|college|kindergarten)$"]({bb});
  way["amenity"~"^(school|college|kindergarten)$"]({bb});
  node["amenity"="drinking_water"]({bb});
  node["man_made"~"^(water_well|water_tower)$"]({bb});
  way["natural"="water"]({bb});
  way["waterway"~"^(river|stream|canal)$"]({bb});
  way["highway"~"^({ROAD})$"]({bb});
);
out geom;"""


def km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(h))


def densify(pts, step_km=0.15, cap=60):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = km(a, b)
        k = int(d // step_km)
        for i in range(1, k + 1):
            t = i * step_km / d
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        out.append(b)
    if len(out) > cap:
        out = out[:: math.ceil(len(out) / cap)]
    return out


def kind(t):
    if t.get("place"): return "settlement"
    if t.get("amenity") in ("school", "college", "kindergarten"): return "school"
    if t.get("natural") == "water" or t.get("waterway") or t.get("amenity") == "drinking_water" or t.get("man_made") in ("water_well", "water_tower"): return "water"
    if t.get("highway"): return "road"


def main():
    b = bbox()
    print("Area (west, south, east, north):", [round(x, 3) for x in b], "- asking Overpass, this can take a minute...")
    req = urllib.request.Request(URL, data=urllib.parse.urlencode({"data": query(b)}).encode(), headers={"User-Agent": "TerraPulse-student-project"})
    data = json.load(urllib.request.urlopen(req, timeout=240))
    feats = []
    for el in data.get("elements", []):
        t = el.get("tags", {})
        k = kind(t)
        if not k:
            continue
        if el["type"] == "node":
            pts = [(el["lat"], el["lon"])]
        else:
            g = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
            if not g:
                continue
            pts = densify(g, cap=60) if k in ("road", "water") else [(sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g))]
        feats.append({"type": k, "name": t.get("name:en") or t.get("name"), "points": [[round(a, 5), round(c, 5)] for a, c in pts]})
    OUT.write_text(json.dumps({"source": "OpenStreetMap contributors (Overpass API)", "fetched": date.today().isoformat(), "features": feats}), encoding="utf-8")
    counts = {k: sum(1 for f in feats if f["type"] == k) for k in ("settlement", "school", "water", "road")}
    print("Saved", OUT, counts)
    if not counts["settlement"]:
        print("WARNING: no settlements found. Check your internet connection or try again later.", file=sys.stderr)


if __name__ == "__main__":
    main()
