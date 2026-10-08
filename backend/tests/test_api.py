import json, os, subprocess, sys, time, tempfile, pathlib
os.environ["TERRAPULSE_DB"] = tempfile.mktemp(suffix=".db")
LOG = tempfile.mktemp(suffix=".jsonl")
port = 18765
stub = subprocess.Popen([sys.executable, str(pathlib.Path(__file__).parent / "stub_gemini.py"), str(port), LOG])
time.sleep(1)
os.environ["GEMINI_BASE_URL"] = f"http://127.0.0.1:{port}/v1beta"
os.environ["GEMINI_API_KEY"] = "TEST_KEY"
os.environ["OFFICE_USERNAME"] = "ranger.test"
os.environ["OFFICE_PASSWORD"] = "Test-Pass-123"
os.environ["OFFICE_NAME"] = "Test Range Office"
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from fastapi.testclient import TestClient
from app.main import app
ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name, extra); ok &= bool(cond)
try:
    with TestClient(app) as c:
        check("health is public", c.get("/api/health").status_code == 200)
        check("data route blocked without token", c.get("/api/dashboard").status_code == 401)
        check("bad token rejected", c.get("/api/dashboard", headers={"Authorization": "Bearer abc.def"}).status_code == 401)
        check("wrong password rejected", c.post("/api/auth/login", json={"username": "ranger.test", "password": "nope"}).status_code == 401)
        check("unknown user rejected", c.post("/api/auth/login", json={"username": "ghost", "password": "x"}).status_code == 401)
        lg = c.post("/api/auth/login", json={"username": "Ranger.Test", "password": "Test-Pass-123"})
        check("login ok (username case-insensitive)", lg.status_code == 200 and lg.json()["user"]["name"] == "Test Range Office")
        tok = lg.json()["token"]
        check("tampered token rejected", c.get("/api/dashboard", headers={"Authorization": "Bearer " + tok[:-2] + "xx"}).status_code == 401)
        import app.auth as A
        _old = A.TOKEN_HOURS; A.TOKEN_HOURS = -1; expired, _ = A.make_token("ranger.test"); A.TOKEN_HOURS = _old
        check("expired token rejected", c.get("/api/dashboard", headers={"Authorization": "Bearer " + expired}).status_code == 401)
        c.headers.update({"Authorization": "Bearer " + tok})
        check("/api/auth/me with token", c.get("/api/auth/me").json()["user"]["username"] == "ranger.test")
        h = c.get("/api/health").json(); check("model+csv load", h["model_loaded"] and h["csv_loaded"] and h["rows"] == 27, h["sklearn_version_warning"])
        d = c.get("/api/dashboard").json(); check("dashboard from data", d["observations"] == 27 and d["ml_detected"] == 0, f"incidents={d['incidents']} by_risk={d['by_risk']}")
        inc = c.get("/api/incidents").json(); check("incidents list", inc["count"] == 27)
        check("filter risk", c.get("/api/incidents?risk=moderate").json()["count"] == 3)
        check("filter tag", c.get("/api/incidents?tag=vegetation change").json()["count"] == 6)
        i3 = c.get("/api/incidents/TP-003").json()
        csvrow = open("data/TerraPulse_Forest_Disturbance_Evidence.csv").read().splitlines()[3]
        check("incident = real CSV row 4 (2_0)", csvrow.startswith("2_0") and abs(i3["features"]["NDVI"] - 0.65676165) < 1e-6, f"lon={i3['lon']} lat={i3['lat']}")
        p = c.post("/api/predict", json=i3["features"]).json(); check("predict matches record", abs(p["probability"] - i3["ml"]["probability"]) < 1e-12, f"p={p['probability']} detected={p['disturbance_detected']}")
        bad = c.post("/api/predict", json={**i3["features"], "NDVI": 5}); check("invalid features rejected", bad.status_code == 422)
        bad2 = c.post("/api/predict", json={**i3["features"], "Forest": 2}); check("invalid Forest rejected", bad2.status_code == 422)
        check("404 unknown incident", c.get("/api/incidents/TP-999").status_code == 404)
        pr = c.get("/api/incidents/TP-003/prompt?scenario=fire").json(); check("prompt has all 6 sections", list(pr["sections"].keys()) == ["ROLE","CONTEXT","EVIDENCE","TASK","CONSTRAINTS","OUTPUT FORMAT"])
        r = c.post("/api/incidents/TP-003/investigate", json={"scenario": "investigate"}); check("investigate", r.status_code == 200, r.text[:120])
        res = r.json()["investigation"]["result"]
        check("guard: risk level overridden to rule-based", res["risk_assessment"]["level"] == "MODERATE")
        check("guard: fire confirmed forced false", res["fire_assessment"]["confirmed"] is False)
        reqs = [json.loads(l) for l in open(LOG)]
        user_text = reqs[0]["body"]["contents"][0]["parts"][0]["text"]
        check("Gemini got real evidence", "0.65676165" in user_text and "348.35" in user_text and "11.64" in user_text)
        check("Gemini got constraints", "Do NOT confirm a fire" in reqs[0]["body"]["system_instruction"]["parts"][0]["text"])
        check("key sent only in header, not in body", "TEST_KEY" not in json.dumps(reqs[0]["body"]) and reqs[0]["key"] == "TEST_KEY")
        check("status -> UNDER INVESTIGATION", c.get("/api/incidents/TP-003").json()["status"] == "UNDER INVESTIGATION")
        ch = c.post("/api/incidents/TP-003/chat", json={"message": "Why was this flagged?"}); check("chat", ch.status_code == 200 and ch.json()["reply"] == "STUB CHAT REPLY")
        creq = [json.loads(l) for l in open(LOG)][-1]
        ctext = json.dumps(creq["body"]); check("chat carries incident evidence + prior investigation", "0.65676165" in ctext and "STUB" in ctext and "Why was this flagged?" in ctext)
        check("fire scenario", c.post("/api/incidents/TP-003/investigate", json={"scenario": "fire"}).status_code == 200)
        rep = c.post("/api/incidents/TP-003/report").json(); check("report 13 sections", len(rep["body"]["sections"]) == 13)
        check("report markdown", "## 13." in c.get(f"/api/reports/{rep['id']}/markdown").text)
        a = c.get("/api/alerts").json(); check("alerts only MODERATE+", a["count"] == 3 and a["high_or_critical"] == 0, a["alerts"][0]["headline"])
        check("status update", c.post("/api/incidents/TP-003/status", json={"status": "REVIEWED"}).status_code == 200)
        os.environ["GEMINI_API_KEY"] = ""
        import app.config as cfg; cfg.GEMINI_API_KEY = ""
        e = c.post("/api/incidents/TP-001/investigate"); check("missing key -> clear 503", e.status_code == 503 and "GEMINI_API_KEY" in e.text)
        cfg.GEMINI_API_KEY = "x"; cfg.GEMINI_BASE_URL = "http://127.0.0.1:9/v1beta"
        e = c.post("/api/incidents/TP-001/investigate"); check("gemini unreachable -> 502", e.status_code == 502, e.text[:90])
        for _ in range(5): c.post("/api/auth/login", json={"username": "lock.me", "password": "bad"})
        check("lockout after 5 failures -> 429", c.post("/api/auth/login", json={"username": "lock.me", "password": "bad"}).status_code == 429)
finally:
    stub.terminate()
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
