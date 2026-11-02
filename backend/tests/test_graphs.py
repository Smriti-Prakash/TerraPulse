"""Graph and incident-comparison tests. All data below is SYNTHETIC and lives only in temporary files created by this test."""
import json, os, pathlib, sys, tempfile

tmp = pathlib.Path(tempfile.mkdtemp())
os.environ.update({
    "TERRAPULSE_DB": str(tmp / "t.db"), "TERRAPULSE_UPLOADS": str(tmp / "up"), "TERRAPULSE_FIRE_CSV": str(tmp / "fire.csv"), "TERRAPULSE_BOUNDARY": str(tmp / "b.geojson"),
    "TERRAPULSE_OSM": str(tmp / "osm.json"), "TERRAPULSE_HANSEN": str(tmp / "hansen.csv"), "TERRAPULSE_CHANGE": str(tmp / "change.csv"),
    "TERRAPULSE_MONTHLY": str(tmp / "monthly.csv"), "OFFICE_USERNAME": "ranger.test", "OFFICE_PASSWORD": "Test-Pass-123", "GEMINI_API_KEY": "",
})
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from fastapi.testclient import TestClient
from app.main import app, _guard
from app import compare, prompts
from app.core import engine

ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name, extra); ok &= bool(cond)

with TestClient(app) as c:
    off = c.post("/api/auth/login", json={"username": "ranger.test", "password": "Test-Pass-123"}).json()["token"]; HO = {"Authorization": "Bearer " + off}
    cz = c.post("/api/auth/register", json={"name": "Cit Zen", "username": "cit.zen", "password": "GoodPass-123"}).json()["token"]; HC = {"Authorization": "Bearer " + cz}
    incs = [r for r in engine.records if r["incident_id"]]
    rec = incs[0]; iid = rec["incident_id"]; LAT, LON = rec["lat"], rec["lon"]
    q = f"lat={LAT}&lon={LON}"

    # ---------------------------------------------------------- no data files
    j = c.get(f"/api/timeseries?{q}", headers=HO).json()
    check("no files: every series says unavailable and has no points", all(s["status"] == "unavailable" and not s["points"] and "unavailable" in s["message"].lower() for s in j["series"]), [s["status"] for s in j["series"]])
    check("citizen cannot call the graph or compare endpoints", c.get(f"/api/timeseries?{q}", headers=HC).status_code == 403 and c.get(f"/api/incidents/{iid}/compare", headers=HC).status_code == 403)
    check("outside the study area is rejected", c.get("/api/timeseries?lat=20&lon=80", headers=HO).status_code == 400)
    check("bad granularity rejected", c.get(f"/api/timeseries?{q}&granularity=week", headers=HO).status_code == 400)
    check("bad date rejected", c.get(f"/api/timeseries?{q}&start=last-year", headers=HO).status_code == 400)

    # ---------------------------------------------------------- synthetic files
    fire = ["latitude,longitude,acq_date,acq_time,confidence"]
    fire += [f"{LAT+0.001},{LON+0.001},2023-03-0{d},0200,h" for d in (1, 2, 3)]          # 3 near, March 2023
    fire += [f"{LAT+0.002},{LON},2024-02-10,0200,n"]                                       # 1 near, Feb 2024
    fire += [f"{LAT+0.2},{LON+0.2},2023-03-05,0200,n"]                                     # far away: never counted at radius 2 km
    fire += [f"{LAT},{LON},2024-12-30,0200,n"]
    (tmp / "fire.csv").write_text("\n".join(fire) + "\n")
    ch = ["point_id,latitude,longitude,year,window,ndvi,nbr,rain_mm,hansen_loss_year"]
    for y, nd, nb in [(2021, .70, .60), (2022, .71, .61), (2023, .45, .30), (2024, .44, .31)]:
        ch.append(f"PX,{LAT},{LON},{y},01-03,{nd},{nb},100,0")
    for y in (2021, 2022):
        ch.append(f"PFAR,{LAT+0.5},{LON+0.5},{y},01-03,.6,.5,90,0")
    (tmp / "change.csv").write_text("\n".join(ch) + "\n")

    y = c.get(f"/api/timeseries?{q}&granularity=year&metrics=fire,ndvi,nbr,rain", headers=HO).json()
    S = {s["metric"]: s for s in y["series"]}
    fy = {p["t"]: p["v"] for p in S["fire"]["points"]}
    check("fire by year: counts only inside the radius, zero-filled across the covered years", fy == {"2023": 3, "2024": 2}, fy)
    check("ndvi yearly values come straight from the file", [p["v"] for p in S["ndvi"]["points"]] == [.7, .71, .45, .44] and S["ndvi"]["status"] == "ok")
    check("flag years use the same rule as Change Over Time (2023 flagged, 2024 not a new event)", y["flag_years"] == [2023], y["flag_years"])
    check("series point is the nearest file point", y["series_point"]["point_id"] == "PX" and y["series_point"]["distance_km"] < 0.1)
    check("missing detections are not described as no fire", "not evidence of no fire" in S["fire"]["note"])
    m = c.get(f"/api/timeseries?{q}&granularity=month&metrics=fire,ndvi&start=2023-02&end=2024-03", headers=HO).json()
    SM = {s["metric"]: s for s in m["series"]}
    mp = {p["t"]: p["v"] for p in SM["fire"]["points"]}
    check("fire by month: window respected and gaps filled with real zeros", list(mp)[0] == "2023-03" and list(mp)[-1] == "2024-03" and mp["2023-03"] == 3 and mp["2024-02"] == 1 and mp["2023-04"] == 0, mp)
    check("monthly vegetation without a monthly file says unavailable and does NOT reuse yearly values", SM["ndvi"]["status"] == "unavailable" and SM["ndvi"]["points"] == [])
    (tmp / "monthly.csv").write_text("point_id,latitude,longitude,month,ndvi,nbr,rain_mm\n" + "\n".join([f"PX,{LAT},{LON},2023-0{i},{0.5+i/100},{0.4+i/100},{10*i}" for i in (1, 2)] + [f"PX,{LAT},{LON},2023-03,,,5"]) + "\n")
    m2 = c.get(f"/api/timeseries?{q}&granularity=month&metrics=ndvi,rain&start=2023-01&end=2023-03", headers=HO).json()
    S2 = {s["metric"]: s for s in m2["series"]}
    check("monthly file: values as supplied, cloudy month stays an empty gap", [p["v"] for p in S2["ndvi"]["points"]] == [0.51, 0.52, None] and [p["v"] for p in S2["rain"]["points"]] == [10.0, 20.0, 5.0], S2["ndvi"]["points"])
    far = c.get(f"/api/timeseries?lat={LAT+0.05}&lon={LON+0.05}&granularity=year&metrics=ndvi", headers=HO).json()
    check("too far from any series point: not covered, no values", far["series"][0]["status"] == "not_covered" and far["series"][0]["points"] == [])
    nc = c.get(f"/api/timeseries?{q}&granularity=year&metrics=fire&start=2010&end=2012", headers=HO).json()
    check("dates outside the fire file: not covered", nc["series"][0]["status"] == "not_covered")

    # ---------------------------------------------------------- ask for a graph (no AI key: rule-based reading)
    a = c.post("/api/timeseries/ask", headers=HO, json={"text": f"show the greenness and fire at {iid.lower()} from 2021 to 2024"}); aj = a.json()
    check("ask: incident resolved, metrics and years read, how it was read is stated", a.status_code == 200 and iid in aj["interpreted_as"] and "2021 to 2024" in aj["interpreted_as"] and "simple rules" in aj["how"], aj.get("interpreted_as"))
    check("ask: values come from the data, not the request", any(s["metric"] == "fire" for s in aj["series"]) and all(isinstance(p["v"], (int, float, type(None))) for s in aj["series"] for p in s["points"]))
    check("ask: unknown incident -> 404 with a helpful message", c.post("/api/timeseries/ask", headers=HO, json={"text": "ndvi at TP-999"}).status_code == 404)
    check("ask: no place given -> 400", c.post("/api/timeseries/ask", headers=HO, json={"text": "show me the trend"}).status_code == 400)
    check("ask: coordinates outside the area -> 400", c.post("/api/timeseries/ask", headers=HO, json={"text": "ndvi at 20.5, 80.2"}).status_code == 400)
    check("ask: monthly wording gives month granularity", c.post("/api/timeseries/ask", headers=HO, json={"text": f"fire by month at {iid}"}).json()["granularity"] == "month")
    from app import timeseries as T
    v = T._validate({"metrics": ["fire", "explode"], "granularity": "decade", "radius_km": 999, "start": "yesterday", "end": "2024-06"})
    check("validator drops unknown metrics, bad granularity, bad dates and clamps the radius", v["metrics"] == ["fire"] and v["granularity"] == "year" and v["radius_km"] == 10.0 and v["start"] is None and v["end"] == "2024-06")
    check("citizen cannot ask for graphs", c.post("/api/timeseries/ask", headers=HC, json={"text": f"ndvi at {iid}"}).status_code == 403)

    # ---------------------------------------------------------- compare with other incidents
    cj = c.get(f"/api/incidents/{iid}/compare", headers=HO).json()
    n = len(incs)
    check("compare: other incidents only, never itself", all(r["incident_id"] != iid for r in cj["nearest"] + cj["most_similar"]) and len(cj["nearest"]) == min(3, n - 1))
    check("compare: nearest sorted by distance", [r["distance_km"] for r in cj["nearest"]] == sorted(r["distance_km"] for r in cj["nearest"]))
    check("compare: most similar sorted by similarity distance", [r["similarity_distance"] for r in cj["most_similar"]] == sorted(r["similarity_distance"] for r in cj["most_similar"]))
    rk = cj["ranks"]
    check("compare: ranks are within 1..N and the summary says other recorded incidents, not earlier ones", all(1 <= rk[k] <= rk["of"] for k in rk if k != "of") and "not earlier ones in time" in cj["note"])
    check("compare: differences are real arithmetic on the supplied values", all(abs(r["d_ndvi"] - (r["ndvi"] - round(rec["features"]["NDVI"], 4))) < 1e-3 for r in cj["nearest"]))
    check("compare: fire history from the FIRMS file, with the caution", cj["fire_history"]["status"] == "ok" and "not evidence of no fire" in cj["fire_history"]["note"])
    check("compare: unknown incident -> 404", c.get("/api/incidents/TP-999/compare", headers=HO).status_code == 404)

    # ---------------------------------------------------------- AI investigation gets the comparison, and the guard keeps it honest
    ctx = compare.ai_context(cj); allowed = compare.allowed_ids(cj)
    p = prompts.build_prompt("investigate", {"id": iid, "lat": LAT, "lon": LON, "csv_row_number": rec["csv_row_number"], "system_index": rec["system_index"], "features": rec["features"], "ml": rec["ml"],
                                             "csv_disturbance_probability": rec["csv_disturbance_probability"], "risk": rec["risk"]}, engine.evidence(rec), ctx)
    check("prompt: comparison evidence, output key and the not-earlier-in-time rule are present", "comparison_with_other_incidents" in p["user"] and "never say 'earlier'" in p["system"])
    res = _guard({"comparison_with_other_incidents": [{"incident_id": sorted(allowed)[0], "similarity": "a", "difference": "b"}, {"incident_id": "TP-999", "similarity": "x", "difference": "y"}],
                  "risk_assessment": {"level": rec["risk"]["level"]}}, rec, allowed)
    check("guard: entries naming incidents that were not supplied are removed and the officer is told", len(res["comparison_with_other_incidents"]) == 1 and any("removed" in f for f in res.get("guard_flags", [])))
from app import report as _rep
_d = [0]; _o = _rep._ai_items(["There was a confirmed fire here.", "A fire is not confirmed.", "This was illegal logging.", "Possible dry-season browning."], 5, _d)
check("report: overclaiming AI sentences dropped from the summary, hedged ones kept", _o == ["A fire is not confirmed.", "Possible dry-season browning."] and _d[0] == 2, _o)
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
