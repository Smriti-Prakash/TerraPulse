from __future__ import annotations

import math
import time
from contextlib import asynccontextmanager
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, field_validator

from . import auth, citizen, config, db, prompts
from .core import COMMUNITY_STATEMENT, DATA_GAPS, FEATURES, FEATURE_META, RISK_RULE, UNAVAILABLE, DataError, engine
from .gemini import GeminiError, generate, parse_json


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    auth.init()
    citizen.init()
    engine.load()
    yield


app = FastAPI(title="TerraPulse API", version="1.0", lifespan=lifespan, dependencies=[Depends(auth.require_user)])
app.include_router(auth.router)
app.include_router(citizen.router)
app.include_router(citizen.officer)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def need_data() -> None:
    if engine.model is None or engine.df is None:
        raise HTTPException(503, "TerraPulse data/model not available: " + "; ".join(engine.errors or ["unknown error"]))


def incident_or_404(iid: str) -> dict[str, Any]:
    need_data()
    rec = engine.get_record(iid)
    if rec is None or not rec["incident_id"]:
        raise HTTPException(404, f"Incident {iid} not found")
    return rec


def view(rec: dict[str, Any], states: dict | None = None) -> dict[str, Any]:
    st = (states if states is not None else db.states()).get(rec["incident_id"])
    return engine.incident_view(rec, st)


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health():
    return {
        "model_loaded": engine.model is not None, "csv_loaded": engine.df is not None,
        "rows": 0 if engine.df is None else len(engine.df), "errors": engine.errors,
        "gemini_configured": bool(config.GEMINI_API_KEY), "gemini_model": config.GEMINI_MODEL,
        "sklearn_version_warning": engine.model_info.get("sklearn_version_warning"),
    }


@app.get("/api/methodology")
def methodology():
    return {"risk_rule": RISK_RULE, "data_gaps": DATA_GAPS, "feature_meta": FEATURE_META,
            "ml_threshold": config.ML_THRESHOLD, "thermal_threshold_K": config.THERMAL_THRESHOLD_K,
            "scenarios": {k: v["name"] for k, v in prompts.SCENARIOS.items()},
            "community_statement": COMMUNITY_STATEMENT}


# --------------------------------------------------------------- dashboard
@app.get("/api/dashboard")
def dashboard():
    need_data()
    d = engine.dashboard()
    st = db.states()
    inv = db.investigated_ids()
    d["under_investigation"] = sum(1 for v in st.values() if v["status"] == "UNDER INVESTIGATION")
    d["reviewed"] = sum(1 for v in st.values() if v["status"] == "REVIEWED")
    d["ai_investigated"] = len(inv)
    d["demo_records"] = engine.demo_records()
    top = sorted([r for r in engine.records if r["incident_id"]], key=lambda r: (-r["risk"]["score"], -r["ml"]["probability"]))[:5]
    d["priority"] = [view(r, st) for r in top]
    return d


@app.get("/api/observations")
def observations():
    need_data()
    st = db.states()
    return {"observations": [
        {"row": r["row"], "csv_row_number": r["csv_row_number"], "system_index": r["system_index"], "lat": r["lat"], "lon": r["lon"],
         "cluster": r["cluster"], "features": r["features"], "ml": r["ml"], "csv_disturbance_probability": r["csv_disturbance_probability"],
         "risk_level": r["risk"]["level"], "signals": r["risk"]["signals"], "incident_id": r["incident_id"],
         "status": st.get(r["incident_id"], {}).get("status", "NEW") if r["incident_id"] else None}
        for r in engine.records],
        "reference": engine.ref, "feature_meta": FEATURE_META, "time_series": UNAVAILABLE + " — time-series data unavailable (no timestamps in CSV)."}


# --------------------------------------------------------------- incidents
@app.get("/api/incidents")
def incidents(risk: str | None = None, tag: str | None = None, status: str | None = None):
    need_data()
    st = db.states()
    inv = db.investigated_ids()
    out = []
    for r in engine.records:
        if not r["incident_id"]:
            continue
        v = view(r, st)
        v["ai_investigated"] = r["incident_id"] in inv
        if risk and v["risk"]["level"] != risk.upper():
            continue
        if tag and tag not in v["tags"]:
            continue
        if status and v["status"] != status.upper():
            continue
        out.append(v)
    out.sort(key=lambda v: (-v["risk"]["score"], -v["ml"]["probability"], v["id"]))
    return {"incidents": out, "count": len(out)}


@app.get("/api/incidents/{iid}")
def incident(iid: str):
    rec = incident_or_404(iid)
    v = view(rec)
    return {**v, "evidence": engine.evidence(rec), "investigations": db.latest_investigations(iid),
            "chat": db.get_chat(iid), "alert": alert_for(rec)}


class StatusIn(BaseModel):
    status: Literal["NEW", "UNDER INVESTIGATION", "REVIEWED"]


@app.post("/api/incidents/{iid}/status")
def set_status(iid: str, body: StatusIn):
    incident_or_404(iid)
    db.set_status(iid, body.status)
    return {"id": iid, "status": body.status}


# ----------------------------------------------------------------- predict
class PredictIn(BaseModel):
    NDVI: float = Field(ge=-1, le=1)
    NBR: float = Field(ge=-1, le=1)
    VV: float = Field(ge=-60, le=30)
    VH: float = Field(ge=-60, le=30)
    Fire_Brightness: float = Field(ge=0, le=1000)
    Temperature: float = Field(gt=150, lt=400)
    Rainfall: float = Field(ge=0)
    Forest: Literal[0, 1]

    @field_validator("*")
    @classmethod
    def finite(cls, v):
        if isinstance(v, float) and not math.isfinite(v):
            raise ValueError("must be finite")
        return v


@app.post("/api/predict")
def predict(body: PredictIn):
    need_data()
    feats = {k: float(getattr(body, k)) for k in FEATURES}
    try:
        pred = engine.predict(feats)
    except DataError as e:
        raise HTTPException(503, str(e))
    risk = engine.assess(feats, pred)
    return {"features": feats, "feature_order": FEATURES, **pred,
            "label": "Potential forest disturbance" if pred["disturbance_detected"] else "No disturbance detected",
            "risk": risk, "model": "TerraPulse_RF_200"}


# ------------------------------------------------------------------ alerts
def alert_for(rec: dict[str, Any]) -> dict[str, Any] | None:
    risk = rec["risk"]
    if risk["score"] < 2:
        return None
    s, f = risk["signals"], rec["features"]
    tier = {"MODERATE": "ADVISORY", "HIGH": "HIGH PRIORITY", "CRITICAL": "CRITICAL"}[risk["level"]]
    if s["ml_detected"] and s["thermal_signal"]:
        headline = "Potential fire-related forest disturbance — unconfirmed"
    elif s["ml_detected"]:
        headline = "Potential forest disturbance detected by the Random Forest"
    elif s["thermal_signal"] and s["vegetation_anomaly"]:
        headline = "Thermal signal coincides with a vegetation anomaly — ML does not flag disturbance"
    else:
        headline = "Watch item"
    evidence = [
        f"Random Forest disturbance probability {rec['ml']['probability']:.3f} (threshold {config.ML_THRESHOLD})",
        f"Fire_Brightness {f['Fire_Brightness']:g} K" + (" (≥ thermal screening threshold)" if s["thermal_signal"] else ""),
        f"NDVI {f['NDVI']:.3f}, NBR {f['NBR']:.3f}" + (" (low vs other sampled points)" if s["vegetation_anomaly"] else ""),
    ]
    concern = ("Possible fire-related disturbance — not confirmed." if s["ml_detected"] and s["thermal_signal"] else
               "Thermal and vegetation indicators warrant verification; the disturbance model does not currently support a disturbance finding.")
    action = ("Prioritize further investigation; obtain acquisition date, fire detection confidence and field verification."
              if risk["level"] in ("HIGH", "CRITICAL") else
              "Review and verify: obtain acquisition date, fire detection confidence and, if possible, field confirmation before escalating.")
    return {"incident_id": rec["incident_id"], "tier": tier, "level": risk["level"], "headline": headline,
            "location": config.STUDY_AREA, "lat": rec["lat"], "lon": rec["lon"], "supporting_evidence": evidence,
            "potential_concern": concern, "community": COMMUNITY_STATEMENT, "recommended_action": action,
            "data_mode": "HISTORICAL DATA — not a live feed"}


@app.get("/api/alerts")
def alerts():
    need_data()
    out = [a for a in (alert_for(r) for r in engine.records if r["incident_id"]) if a]
    order = {"CRITICAL": 0, "HIGH": 1, "MODERATE": 2}
    out.sort(key=lambda a: order[a["level"]])
    return {"alerts": out, "count": len(out),
            "high_or_critical": sum(1 for a in out if a["level"] in ("HIGH", "CRITICAL")),
            "note": "Alerts are generated for MODERATE or higher risk. HIGH/CRITICAL require the Random Forest to flag disturbance." }


# ------------------------------------------------------------ investigation
class InvestigateIn(BaseModel):
    scenario: Literal["investigate", "fire", "community"] = "investigate"


@app.get("/api/incidents/{iid}/prompt")
def get_prompt(iid: str, scenario: Literal["investigate", "fire", "community"] = Query("investigate")):
    rec = incident_or_404(iid)
    p = prompts.build_prompt(scenario, view(rec), engine.evidence(rec))
    return p


def _guard(result: dict[str, Any], rec: dict[str, Any]) -> dict[str, Any]:
    """Server-side guardrails on the model output."""
    fa = result.get("fire_assessment")
    if isinstance(fa, dict):
        fa["confirmed"] = False
    ra = result.get("risk_assessment")
    if isinstance(ra, dict) and str(ra.get("level", "")).upper() != rec["risk"]["level"]:
        ra["model_stated_level"] = ra.get("level")
        ra["level"] = rec["risk"]["level"]
        ra["note"] = "Level replaced with the rule-based level; the language model's stated level differed."
    return result


@app.post("/api/incidents/{iid}/investigate")
def investigate(iid: str, body: InvestigateIn | None = None):
    rec = incident_or_404(iid)
    scenario = (body or InvestigateIn()).scenario
    v, ev = view(rec), engine.evidence(rec)
    p = prompts.build_prompt(scenario, v, ev)
    try:
        text = generate(p["system"], [{"role": "user", "parts": [{"text": p["user"]}]}], json_mode=True)
        result = _guard(parse_json(text), rec)
    except GeminiError as e:
        raise HTTPException(e.status, str(e))
    if db.get_status(iid) == "NEW":
        db.set_status(iid, "UNDER INVESTIGATION")
    saved = db.save_investigation(iid, scenario, result, p["user"], config.GEMINI_MODEL)
    return {"investigation": saved, "prompt": p["sections"], "status": db.get_status(iid)}


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@app.post("/api/incidents/{iid}/chat")
def chat(iid: str, body: ChatIn):
    rec = incident_or_404(iid)
    history = db.get_chat(iid)
    inv = db.latest_investigations(iid).get("investigate")
    c = prompts.build_chat(view(rec), engine.evidence(rec), history, body.message.strip(), inv["result"] if inv else None)
    try:
        text = generate(c["system"], c["contents"], json_mode=False, temperature=0.3)
    except GeminiError as e:
        raise HTTPException(e.status, str(e))
    db.add_chat(iid, "user", body.message.strip())
    db.add_chat(iid, "assistant", text.strip())
    return {"reply": text.strip(), "chat": db.get_chat(iid)}


# ----------------------------------------------------------------- reports
AI_PENDING = "AI investigation not yet generated for this incident."


def build_report(rec: dict[str, Any]) -> dict[str, Any]:
    v, ev = view(rec), engine.evidence(rec)
    invs = db.latest_investigations(rec["incident_id"])
    a = invs.get("investigate", {}).get("result")
    fire = invs.get("fire", {}).get("result")
    com = invs.get("community", {}).get("result")
    g = (lambda d, *ks: _dig(d, ks)) if a else (lambda d, *ks: AI_PENDING)
    f = rec["features"]
    return {
        "title": f"TerraPulse Investigation Report — {v['id']}",
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "mode": "HISTORICAL DATA DEMONSTRATION — not a live feed",
        "ai_generated": a is not None, "ai_model": invs.get("investigate", {}).get("model"),
        "sections": [
            {"n": 1, "title": "Incident overview", "kind": "data", "body": f"{v['id']} — {v['title']}. Status: {v['status']}. Risk: {v['risk']['level']}. ML assessment: {v['ml_assessment']}."},
            {"n": 2, "title": "Location", "kind": "data", "body": f"{config.STUDY_AREA}. Latitude {rec['lat']:.6f}, longitude {rec['lon']:.6f} ({rec['cluster']}). Source: CSV row {rec['csv_row_number']} (system:index {rec['system_index']})."},
            {"n": 3, "title": "Detection evidence", "kind": "data", "table": [{"name": FEATURE_META[k]["label"], "value": f"{f[k]:g}", "unit": FEATURE_META[k]["unit"]} for k in FEATURES],
             "body": "Values exactly as supplied in the CSV. Units are inferred (not stored in the file) except where noted."},
            {"n": 4, "title": "ML assessment", "kind": "data", "body": f"Random Forest (TerraPulse_RF_200, 200 trees): disturbance probability {rec['ml']['probability']:.3f}, threshold {config.ML_THRESHOLD}, disturbance detected: {'yes' if rec['ml']['disturbance_detected'] else 'no'}. CSV-supplied probability {rec['csv_disturbance_probability']:.3f} (unverified pipeline; does not match the model output)."},
            {"n": 5, "title": "Vegetation assessment", "kind": "ai", "body": _text(g(a, "vegetation_assessment"), AI_PENDING),
             "note": "Reference/current/change values: " + UNAVAILABLE + ". NDVI/NBR comparison is spatial, not temporal."},
            {"n": 6, "title": "Fire-related assessment", "kind": "ai", "body": _text((fire or {}).get("fire_assessment") or g(a, "fire_assessment"), AI_PENDING),
             "note": ev["fire"]["label"] + ". Not confirmed."},
            {"n": 7, "title": "Possible causes (hypotheses)", "kind": "ai", "body": _text(g(a, "possible_causes"), AI_PENDING)},
            {"n": 8, "title": "Environmental impact", "kind": "ai", "body": _text(g(a, "environmental_impact"), AI_PENDING)},
            {"n": 9, "title": "Community impact", "kind": "ai", "body": _text((com or {}).get("community_impact") or g(a, "community_impact"), AI_PENDING), "note": COMMUNITY_STATEMENT},
            {"n": 10, "title": "Risk level", "kind": "data", "body": f"{v['risk']['level']} (score {v['risk']['score']}/4). " + " ".join(v["risk"]["reasons"] + v["risk"]["not_triggered"]) + " Rule: " + RISK_RULE["summary"]},
            {"n": 11, "title": "Missing evidence", "kind": "ai", "body": _text(g(a, "missing_evidence"), AI_PENDING), "gaps": DATA_GAPS},
            {"n": 12, "title": "Recommended action", "kind": "ai", "body": _text(g(a, "recommended_action"), AI_PENDING)},
            {"n": 13, "title": "Data / evidence used", "kind": "data", "body": "TerraPulse_Forest_Disturbance_Evidence.csv (historical); TerraPulse_RF_200.joblib (Random Forest); Google Gemini (" + (invs.get("investigate", {}).get("model") or "not yet run") + ") for the narrative sections, grounded on the evidence above."},
        ],
        "confidence": _text(g(a, "confidence"), AI_PENDING),
    }


def _dig(d: dict | None, keys: tuple) -> Any:
    cur: Any = d
    for k in keys:
        cur = cur.get(k) if isinstance(cur, dict) else None
    return cur if cur not in (None, "", []) else UNAVAILABLE


def _text(v: Any, default: str) -> str:
    if v is None:
        return default
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return " ".join(f"{k.replace('_', ' ').capitalize()}: {_text(x, '')}" for k, x in v.items() if x not in (None, ""))
    if isinstance(v, list):
        return "\n".join("• " + _text(x, "") for x in v)
    return str(v)


def report_markdown(rep: dict[str, Any]) -> str:
    lines = [f"# {rep['title']}", f"*{rep['mode']}* · generated {rep['generated']}", ""]
    for s in rep["sections"]:
        lines += [f"## {s['n']}. {s['title']}", s["body"], ""]
        if s.get("table"):
            lines += ["| Feature | Value | Unit |", "|---|---|---|"] + [f"| {r['name']} | {r['value']} | {r['unit']} |" for r in s["table"]] + [""]
        if s.get("note"):
            lines += [f"> {s['note']}", ""]
    lines += ["## Confidence / uncertainty", rep["confidence"], ""]
    return "\n".join(lines)


@app.post("/api/incidents/{iid}/report")
def make_report(iid: str):
    rec = incident_or_404(iid)
    rep = build_report(rec)
    saved = db.save_report(iid, rep)
    return saved


@app.get("/api/reports")
def reports():
    return {"reports": db.list_reports()}


@app.get("/api/reports/{rid}")
def report(rid: int):
    r = db.get_report(rid)
    if not r:
        raise HTTPException(404, "Report not found")
    return r


@app.get("/api/reports/{rid}/markdown", response_class=PlainTextResponse)
def report_md(rid: int):
    r = db.get_report(rid)
    if not r:
        raise HTTPException(404, "Report not found")
    return report_markdown(r["body"])
