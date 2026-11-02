"""Download NASA FIRMS fire detections for the TerraPulse study area (several years) into backend/data/fire_detections.csv.

1. Get a free MAP_KEY: https://firms.modaps.eosdis.nasa.gov/api/map_key/   (needs an e-mail address)
2. Run (example: eight years of VIIRS standard-processing data):
       set FIRMS_MAP_KEY=your_key_here            (Windows PowerShell:  $env:FIRMS_MAP_KEY="your_key_here")
       python tools/fetch_firms.py --start 2018-01-01 --end 2025-12-31 --source VIIRS_SNPP_SP
   Recent weeks are not in the standard archive yet; use --source VIIRS_SNPP_NRT for them and run the script again
   with --append. The key is read from the environment and never written to any file.
Output columns: latitude, longitude, acq_date, acq_time, confidence  (what the backend expects).
The same file powers the fire cross-check on citizen reports, fire-season planning and Replay mode.
"""
import argparse, csv, io, os, pathlib, sys, time, urllib.request
from datetime import date, timedelta
from _points import bbox

OUT = pathlib.Path(__file__).resolve().parent.parent / "backend" / "data" / "fire_detections.csv"
CHUNK = 5  # days per request (the FIRMS area API allows a small day range per call)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True); ap.add_argument("--end", required=True)
    ap.add_argument("--source", default="VIIRS_SNPP_SP"); ap.add_argument("--append", action="store_true")
    a = ap.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Set the FIRMS_MAP_KEY environment variable first (see the top of this file).")
    w, s, e, n = bbox()
    d, end = date.fromisoformat(a.start), date.fromisoformat(a.end)
    rows, seen = [], set()
    if a.append and OUT.exists():
        for r in csv.DictReader(open(OUT, newline="")):
            rows.append(r); seen.add((r["latitude"], r["longitude"], r["acq_date"], r["acq_time"]))
    got = 0
    total_days = max(1, (end - d).days + 1); start_d = d; calls = 0
    while d <= end:
        days = min(CHUNK, (end - d).days + 1)
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{a.source}/{w:.4f},{s:.4f},{e:.4f},{n:.4f}/{days}/{d.isoformat()}"
        for attempt in range(3):
            try:
                text = urllib.request.urlopen(url, timeout=60).read().decode()
                break
            except Exception as ex:  # noqa: BLE001  (never print the URL: it contains the key)
                if attempt == 2:
                    sys.exit(f"Request for {d} failed ({type(ex).__name__}). Check the key, the source name and your connection.")
                time.sleep(3)
        if text.lstrip().lower().startswith(("invalid", "error")):
            sys.exit("FIRMS replied: " + text.strip()[:120])
        for r in csv.DictReader(io.StringIO(text)):
            k = (r["latitude"], r["longitude"], r["acq_date"], r["acq_time"])
            if k not in seen:
                seen.add(k); got += 1
                rows.append({c: r.get(c, "") for c in ("latitude", "longitude", "acq_date", "acq_time", "confidence")})
        d += timedelta(days=days)
        calls += 1
        if calls % 5 == 0 or d > end:
            pct = min(100, round(100 * (d - start_d).days / total_days))
            print(f"  {min(d, end).isoformat()} done  ({pct}%)  {got} new detections so far", flush=True)
        time.sleep(0.2)
    rows.sort(key=lambda r: (r["acq_date"], r["acq_time"]))
    with open(OUT, "w", newline="") as f:
        w_ = csv.DictWriter(f, fieldnames=["latitude", "longitude", "acq_date", "acq_time", "confidence"]); w_.writeheader(); w_.writerows(rows)
    print(f"Saved {len(rows)} detections ({got} new) to {OUT}")


if __name__ == "__main__":
    main()
