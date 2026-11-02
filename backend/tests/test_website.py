"""Website-feature tests: data layers, inconclusive wording, replay, change-over-time, fire season, community alerts.
All data below is SYNTHETIC and exists only inside this test (temporary files); it is never shipped or shown in the app."""
import io, json, os, pathlib, sys, tempfile, time
from datetime import datetime, timezone

tmp = pathlib.Path(tempfile.mkdtemp())
os.environ.update({
    "TERRAPULSE_DB": str(tmp / "t.db"), "TERRAPULSE_UPLOADS": str(tmp / "up"), "TERRAPULSE_FIRE_CSV": str(tmp / "fire.csv"),
    "TERRAPULSE_BOUNDARY": str(tmp / "b.geojson"), "TERRAPULSE_OSM": str(tmp / "osm.json"), "TERRAPULSE_HANSEN": str(tmp / "hansen.csv"),
    "TERRAPULSE_CHANGE": str(tmp / "change.csv"), "OFFICE_USERNAME": "ranger.test", "OFFICE_PASSWORD": "Test-Pass-123", "GEMINI_API_KEY": "",
})
for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "ALERT_SMTP_HOST", "ALERT_HELPLINE"):
    os.environ.pop(k, None)
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from fastapi.testclient import TestClient
from app.main import app
from app import community, layers, citizen

ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name, extra); ok &= bool(cond)

LAT, LON = 11.60, 76.55
try:
    with TestClient(app) as c:
        off = c.post("/api/auth/login", json={"username": "ranger.test", "password": "Test-Pass-123"}).json()["token"]; HO = {"Authorization": "Bearer " + off}
        cz = c.post("/api/auth/register", json={"name": "Cit Zen", "username": "cit.zen", "password": "GoodPass-123"}).json()["token"]; HC = {"Authorization": "Bearer " + cz}

        # ------------------------------------------------ no data files: everything says unavailable, nothing invented
        for path in ("/api/change", "/api/fire-season"):
            j = c.get(path, headers=HO).json(); check(f"{path} without data file -> unavailable", j["status"] == "unavailable" and "unavailable" in j["message"].lower(), j["message"][:60])
        check("replay events without FIRMS file -> unavailable", c.get("/api/replay/fire-events", headers=HO).json()["status"] == "unavailable")
        n = c.get(f"/api/nearby?lat={LAT}&lon={LON}", headers=HO).json(); check("nearby without OSM file -> unavailable", n["status"] == "unavailable")
        check("hansen without file -> unavailable", layers.hansen_check(LAT, LON)["status"] == "unavailable")
        rc = c.post("/api/replay/report-check", headers=HO, json={"lat": LAT, "lon": LON, "at": "2024-03-04T07:30:00Z"}).json()
        check("replay check without FIRMS: CANNOT_CHECK and tagged REPLAY", rc["mode"] == "REPLAY" and rc["checks"]["fire_detections"]["verdict"] == "CANNOT_CHECK")

        # ------------------------------------------------ synthetic layers
        (tmp / "fire.csv").write_text("latitude,longitude,acq_date,acq_time,confidence\n"
            "11.601,76.551,2024-03-04,0200,h\n11.602,76.552,2024-03-04,0210,n\n11.70,76.60,2023-02-10,0600,n\n11.61,76.56,2022-03-02,0100,l\n11.62,76.57,2024-02-20,0100,n\n11.9,76.9,2024-04-05,0100,n\n")
        (tmp / "osm.json").write_text(json.dumps({"source": "OpenStreetMap (test)", "fetched": "2026-01-01", "features": [
            {"type": "settlement", "name": "Testpalli", "lat": 11.62, "lon": 76.55}, {"type": "settlement", "name": "Far", "lat": 11.9, "lon": 76.9},
            {"type": "school", "name": "S1", "lat": 11.61, "lon": 76.55}, {"type": "water", "name": None, "lat": 11.60, "lon": 76.56},
            {"type": "road", "name": "R", "points": [[11.65, 76.55], [11.66, 76.55]]}]}))
        (tmp / "hansen.csv").write_text("latitude,longitude,lossyear\n11.6005,76.5505,2017\n11.6006,76.5506,17\n11.9,76.9,2012\n")
        rows = ["point_id,latitude,longitude,year,window,ndvi,nbr,rain_mm,hansen_loss_year"]
        for y, nd, nb, rn in [(2021, .70, .60, 100), (2022, .71, .61, 105), (2023, .45, .30, 102), (2024, .44, .31, 99)]:  # P1: drop in 2023 (no fire in 2023 window) ; 2024 baseline already low
            rows.append(f"P1,11.60,76.55,{y},01-03,{nd},{nb},{rn},{2023 if y==2023 else 0}")
        for y, nd, nb, rn in [(2022, .72, .62, 100), (2023, .73, .62, 98), (2024, .40, .20, 101)]:  # P2: drop in 2024 with FIRMS detections in window
            rows.append(f"P2,11.601,76.551,{y},01-03,{nd},{nb},{rn},0")
        for y, nd, nb, rn in [(2022, .70, .60, 110), (2023, .71, .60, 108), (2024, .56, .50, 30)]:  # P3: drop in a dry window, far from fire
            rows.append(f"P3,11.5,76.4,{y},01-03,{nd},{nb},{rn},0")
        for y in (2022, 2023, 2024):
            rows.append(f"P4,11.55,76.45,{y},01-03,0.69,0.59,100,0")  # stable
        (tmp / "change.csv").write_text("\n".join(rows) + "\n")

        # ------------------------------------------------ fire verdicts
        ts = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp()
        v = citizen.fire_check(LAT, LON, ts("2024-03-04T05:00:00"))
        check("FIRMS detection within 5 km / 72 h -> DETECTION_NEARBY, wording does not confirm", v["verdict"] == "DETECTION_NEARBY" and "does not confirm" in v["interpretation"])
        v = citizen.fire_check(11.80, 76.30, ts("2024-03-04T05:00:00"))
        check("no detection nearby -> INCONCLUSIVE, never 'no fire'", v["verdict"] == "INCONCLUSIVE" and "not 'no fire'" in v["interpretation"] and "Field verification" in v["interpretation"], v["verdict"])
        v = citizen.fire_check(LAT, LON, ts("2030-01-01T00:00:00"))
        check("report time outside file coverage -> CANNOT_CHECK with coverage", v["verdict"] == "CANNOT_CHECK" and "coverage" in v)

        # ------------------------------------------------ nearby / hansen
        n = c.get(f"/api/nearby?lat={LAT}&lon={LON}&radius_km=5", headers=HO).json()
        check("nearby counts (1 settlement, 1 school, 1 water, 0 roads within 5 km)", n["status"] == "ok" and n["settlement"]["count"] == 1 and n["school"]["count"] == 1 and n["water"]["count"] == 1 and n["road"]["count"] == 0, n["summary_en"])
        check("nearby Tamil summary present", "கி.மீ." in n["summary_ta"])
        check("place name from nearest settlement", layers.place_name(LAT, LON) == "Testpalli")
        h = layers.hansen_check(LAT, LON)
        check("hansen: loss pixels near point, years normalised (17 -> 2017), says supporting only", h["loss_pixels"] == 2 and h["loss_years"] == [2017] and "not proof" in h["note"])

        # ------------------------------------------------ replay events + report check
        ev = c.get("/api/replay/fire-events", headers=HO).json()
        check("replay events from FIRMS archive, top day first", ev["status"] == "ok" and ev["events"][0]["date"] == "2024-03-04" and ev["events"][0]["detections"] == 2 and ev["mode"] == "REPLAY")
        e0 = ev["events"][0]
        rc = c.post("/api/replay/report-check", headers=HO, json={"lat": e0["lat"], "lon": e0["lon"], "at": "2024-03-04T05:00:00Z", "category": "fire"}).json()
        check("replay report-check: detection found, priority +2, tagged REPLAY, nothing stored", rc["mode"] == "REPLAY" and rc["checks"]["fire_detections"]["verdict"] == "DETECTION_NEARBY" and rc["priority"]["score"] >= 4 - 1 and rc["checks"]["community_impact"]["status"] == "ok", str(rc["priority"]["score"]))
        check("replay check has an officer checklist", len(rc["checklist"]) >= 3)
        check("replay check outside study area rejected", c.post("/api/replay/report-check", headers=HO, json={"lat": 20, "lon": 70, "at": "2024-03-04T05:00:00Z"}).status_code == 422)
        check("replay check bad time rejected", c.post("/api/replay/report-check", headers=HO, json={"lat": LAT, "lon": LON, "at": "yesterday"}).status_code == 422)
        check("citizen cannot use replay / officer endpoints", all(c.get(p, headers=HC).status_code == 403 for p in ("/api/replay/fire-events", "/api/change", "/api/fire-season", "/api/community-alerts", "/api/nearby?lat=1&lon=1")))

        # ------------------------------------------------ change over time
        ch = c.get("/api/change", headers=HO).json()
        P = {p["point_id"]: p for p in ch["points"]}
        check("change: real file is labelled HISTORICAL", ch["mode"] == "HISTORICAL" and ch["status"] == "ok" and ch["summary"]["points"] == 4)
        check("change: stable point not flagged", P["P4"]["events"] == [])
        e1 = P["P1"]["events"]
        check("change: P1 flagged once in 2023 (2024 persists, not a new event), Hansen year matches", [e["year"] for e in e1] == [2023] and e1[0]["hansen_matches_year"] and e1[0]["label"] == "Potential vegetation disturbance", str([e["year"] for e in e1]))
        check("change: P1 reading says cause not determined", "not determined" in e1[0]["reading"])
        e2 = P["P2"]["events"][0]
        check("change: P2 flagged 2024 with FIRMS detections in window -> fire-related decline possible", e2["year"] == 2024 and e2["fire"]["status"] == "ok" and e2["fire"]["detections"] >= 1 and "fire-related" in e2["reading"], str(e2["fire"]))
        e3 = P["P3"]["events"][0]
        check("change: P3 dry window -> dry-season effect possible", e3["dry_season"] and "dry-season" in e3["reading"])
        txt = json.dumps(ch).lower()
        check("change: output never says illegal / confirmed", "illegal" not in txt.replace("not show clearing or illegality", "") and "confirmed" not in txt)
        sim = c.get("/api/change/simulation", headers=HO).json()
        check("simulation is labelled SIMULATION and says not measurements", sim["mode"] == "SIMULATION" and "NOT measurements" in sim["source"])
        sp = {p["point_id"]: p for p in sim["points"]}
        check("simulation runs through the same rule (A,B,C each flagged once)", all(len(sp[k]["events"]) == 1 for k in ("SIM-A", "SIM-B", "SIM-C")))

        # ------------------------------------------------ fire season
        fs = c.get("/api/fire-season", headers=HO).json()
        check("fire season: HISTORICAL, monthly counts, watch months, weak-pattern warning (<3 years? 3 years here)", fs["mode"] == "HISTORICAL" and sum(fs["monthly"]) == 6 and fs["monthly"][2] == 3 and "Mar" in fs["watch_months"], str(fs["monthly"]))
        check("fire season: not a live prediction", "not a live prediction" in fs["caution"])

        # ------------------------------------------------ community alerts
        d = c.post("/api/community-alerts/draft", headers=HO, json={"kind": "fire_smoke", "source_type": "replay", "source_ref": "2024-03-04", "lat": e0["lat"], "lon": e0["lon"]}).json()["alert"]
        check("draft: DRAFT status, REPLAY mode, English + Tamil text", d["status"] == "DRAFT" and d["mode"] == "REPLAY" and d["body_en"] and d["body_ta"] and any("஀" <= ch <= "௿" for ch in d["body_ta"]))
        check("draft: says NOT confirmed, uses nearest place, includes area info", "NOT been confirmed" in d["body_en"] and "Testpalli" in d["title_en"] and "Area information" in d["body_en"])
        check("draft: no invented helpline when none configured", "Helpline" not in d["body_en"])
        check("citizen sees no drafts", c.get("/api/citizen/alerts", headers=HC).json()["alerts"] == [])
        check("citizen cannot approve", c.post(f"/api/community-alerts/{d['id']}/approve", headers=HC, json={}).status_code == 403)
        bad = c.post(f"/api/community-alerts/{d['id']}/edit", headers=HO, json={"title_en": "Fire is confirmed", "title_ta": "தீ", "body_en": "The fire is confirmed.", "body_ta": "தீ உறுதி"})
        check("edit works on a draft", bad.status_code == 200 and bad.json()["alert"]["audit"][-1]["event"] == "edited")
        check("approval blocked for 'fire is confirmed' wording", c.post(f"/api/community-alerts/{d['id']}/approve", headers=HO, json={}).status_code == 422)
        c.post(f"/api/community-alerts/{d['id']}/edit", headers=HO, json={"title_en": d["title_en"], "title_ta": d["title_ta"], "body_en": d["body_en"], "body_ta": ""})
        check("approval blocked when Tamil text empty", c.post(f"/api/community-alerts/{d['id']}/approve", headers=HO, json={}).status_code == 422)
        c.post(f"/api/community-alerts/{d['id']}/edit", headers=HO, json={"title_en": d["title_en"], "title_ta": d["title_ta"], "body_en": d["body_en"], "body_ta": d["body_ta"]})
        sent = []
        os.environ.update({"TELEGRAM_BOT_TOKEN": "TOKEN-X", "TELEGRAM_CHAT_ID": "1"})
        class R: status_code = 200
        community.httpx.post = lambda url, json=None, timeout=0: (sent.append(json["text"]) or R())
        a = c.post(f"/api/community-alerts/{d['id']}/approve", headers=HO, json={"note": "ok"}).json()["alert"]
        check("approve: status APPROVED, reviewer recorded, audit trail has 3+ steps", a["status"] == "APPROVED" and a["reviewed_by"] == "ranger.test" and len(a["audit"]) >= 3)
        check("delivery: in-app DEMO, telegram sent (DEMO), email not configured", a["delivery"] == {"in_app": "published (DEMO)", "telegram": "sent (DEMO)", "email": "not configured"}, str(a["delivery"]))
        check("telegram text carries the DEMO prefix in both languages", sent and sent[0].startswith(community.DEMO_EN) and community.DEMO_TA in sent[0])
        community.httpx.post = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("https://api.telegram.org/botTOKEN-X/..."))
        d2 = c.post("/api/community-alerts/draft", headers=HO, json={"kind": "advisory"}).json()["alert"]
        a2 = c.post(f"/api/community-alerts/{d2['id']}/approve", headers=HO, json={}).json()["alert"]
        check("telegram failure is recorded without leaking the bot token", a2["delivery"]["telegram"] == "failed (RuntimeError)" and "TOKEN-X" not in json.dumps(a2))
        for k in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"): os.environ.pop(k)
        ca = c.get("/api/citizen/alerts", headers=HC).json()
        check("citizen sees approved alerts only, labelled DEMO, no audit trail", len(ca["alerts"]) == 2 and ca["alerts"][0]["demo"] and "audit" not in ca["alerts"][0] and "DEMO" in ca["demo_notice"])
        d3 = c.post("/api/community-alerts/draft", headers=HO, json={"kind": "vegetation", "source_type": "manual", "lat": LAT, "lon": LON}).json()["alert"]
        r3 = c.post(f"/api/community-alerts/{d3['id']}/reject", headers=HO, json={"note": "not needed"}).json()["alert"]
        check("reject works, rejected is never shown to citizens", r3["status"] == "REJECTED" and len(c.get("/api/citizen/alerts", headers=HC).json()["alerts"]) == 2)
        check("vegetation template says potential / not determined, never 'illegal'", "potential disturbance" in d3["body_en"] and "not been determined" in d3["body_en"] and "illegal" not in d3["body_en"].lower())
        check("approved alert cannot be edited or approved again", c.post(f"/api/community-alerts/{d['id']}/edit", headers=HO, json={"title_en": "a", "title_ta": "b", "body_en": "c", "body_ta": "d"}).status_code == 409 and c.post(f"/api/community-alerts/{d['id']}/approve", headers=HO, json={}).status_code == 409)
        check("draft needs a location for fire alerts", c.post("/api/community-alerts/draft", headers=HO, json={"kind": "fire_smoke"}).status_code == 422)
        os.environ["ALERT_HELPLINE"] = "1234-TEST"
        d4 = c.post("/api/community-alerts/draft", headers=HO, json={"kind": "advisory"}).json()["alert"]
        check("helpline appears only when configured", "1234-TEST" in d4["body_en"])
        l = c.get("/api/community-alerts", headers=HO).json()
        check("officer list shows channels and DEMO notice", "telegram" in l["channels"] and "DEMO" in l["demo_notice"])

        # ------------------------------------------------ citizen outcome wording (en + ta)
        check("citizen outcome messages in English and Tamil", all(citizen.OUTCOME[k][0] and citizen.OUTCOME[k][1] for k in ("Received", "Under review", "Action taken", "Closed")))
        # ------------------------------------------------ prompt carries the new rules
        from app import prompts
        pr = prompts.build_citizen_prompt({"x": 1})
        check("citizen prompt: inconclusive rule, vegetation wording rule, checklist output", "INCONCLUSIVE" in pr["system"] and "illegal deforestation" in pr["system"] and "verification_checklist" in pr["user"] and "possible_causes" in pr["user"])
        g = citizen.guard_citizen({"credibility": "SUPPORTED", "possible_causes": ["fire — x"] + ["c"] * 10, "verification_checklist": "not a list", "summary": "This is illegal logging"})
        check("guard: lists capped / coerced, legality wording flagged", len(g["possible_causes"]) == 6 and g["verification_checklist"] == [] and g["guard_flags"] and g["confirmed"] is False)
        ck = citizen.verification_checklist("deforestation", {"fire_detections": {}, "reserve_boundary": {}, "other_reports_nearby": {}})
        check("deforestation checklist points to permits, records and boundary and leaves legality to the department", any("permits" in s for s in ck) and any("boundary" in s for s in ck) and any("Legality is decided only by the forest department" in s for s in ck))
finally:
    pass
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
