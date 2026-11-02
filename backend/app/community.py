"""Community alerts: a forest officer drafts, reviews, edits and approves; nothing is sent automatically.

* Wording is written from fixed English and Tamil templates (not by the language model), so what is said is predictable.
* Every alert starts as DRAFT. Only an officer can APPROVE or REJECT it, and every step is recorded in an audit trail.
* Delivery is DEMO ONLY: the in-app alert is shown to signed-in citizens with a DEMO label; a Telegram message and an e-mail are
  sent only if the environment variables below are set. Every delivered text starts with a DEMO prefix.
* Alerts are about POSSIBLE events. The words "confirmed fire", "illegal" etc. are refused at approval time.

Environment (all optional): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ALERT_SMTP_HOST, ALERT_SMTP_PORT, ALERT_SMTP_USER,
ALERT_SMTP_PASSWORD, ALERT_EMAIL_FROM, ALERT_EMAIL_TO (comma separated), ALERT_HELPLINE (shown only if you set it).
"""
from __future__ import annotations

import json
import os
import smtplib
import time
from email.message import EmailMessage
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import db, layers
from .citizen import FLAG_WORDS, _row

KINDS = ("fire_smoke", "vegetation", "advisory")
DEMO_EN = "[DEMO – NOT AN OFFICIAL ALERT]"
DEMO_TA = "[டெமோ – அதிகாரப்பூர்வ எச்சரிக்கை அல்ல]"

router = APIRouter(prefix="/api/community-alerts", tags=["community-alerts"])
citizen_router = APIRouter(prefix="/api/citizen/alerts", tags=["citizen-alerts"])

SCHEMA = """CREATE TABLE IF NOT EXISTS community_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, mode TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT NOT NULL,
  lat REAL, lon REAL, radius_km REAL NOT NULL, place TEXT NOT NULL,
  title_en TEXT NOT NULL, title_ta TEXT NOT NULL, body_en TEXT NOT NULL, body_ta TEXT NOT NULL,
  status TEXT NOT NULL, created_by TEXT NOT NULL, reviewed_by TEXT, review_note TEXT NOT NULL DEFAULT '',
  delivery TEXT NOT NULL DEFAULT '{}', audit TEXT NOT NULL DEFAULT '[]', created REAL NOT NULL, updated REAL NOT NULL);"""


def init() -> None:
    with db.conn() as c:
        c.execute(SCHEMA)


# ------------------------------------------------------------------ wording
def _helpline() -> str:
    return os.getenv("ALERT_HELPLINE", "").strip()


def draft_text(kind: str, place: str, impact_en: str | None, impact_ta: str | None) -> dict[str, str]:
    h = _helpline()
    help_en = f" Helpline: {h}." if h else ""
    help_ta = f" உதவி எண்: {h}." if h else ""
    if kind == "fire_smoke":
        t_en, t_ta = f"Possible fire or smoke reported near {place}", f"{place} அருகே தீ அல்லது புகை இருப்பதாகத் தகவல்"
        b_en = ("Smoke or fire has been reported near this area. It has NOT been confirmed yet and the forest department is checking. "
                "Please stay away from the area, do not enter the forest, keep roads clear for response vehicles, and do not light any fire. "
                "If you see flames or feel in danger, call the forest department or the emergency number 112 immediately.")
        b_ta = ("இந்தப் பகுதியில் புகை அல்லது தீ இருப்பதாகத் தகவல் வந்துள்ளது. இது இன்னும் உறுதிப்படுத்தப்படவில்லை; வனத்துறை சரிபார்த்து வருகிறது. "
                "தயவுசெய்து அந்தப் பகுதிக்குச் செல்ல வேண்டாம், காட்டுக்குள் நுழைய வேண்டாம், மீட்புப் பணி வாகனங்களுக்குச் சாலையை விட்டுவையுங்கள், எங்கும் தீ மூட்ட வேண்டாம். "
                "தீயைக் கண்டாலோ ஆபத்தை உணர்ந்தாலோ உடனே வனத்துறையை அல்லது அவசர எண் 112-ஐ அழைக்கவும்.")
    elif kind == "vegetation":
        t_en, t_ta = f"Possible vegetation loss near {place} under review", f"{place} அருகே தாவரப் பரப்பு குறைந்திருக்கலாம் – ஆய்வில் உள்ளது"
        b_en = ("Satellite records or field reports suggest a possible loss of vegetation near this area. This is a potential disturbance only; "
                "the cause has not been determined and the forest department is verifying it on the ground. Please do not share unverified claims. "
                "If you have information, you can send a report with a photo through TerraPulse.")
        b_ta = ("செயற்கைக்கோள் பதிவுகள் அல்லது கள அறிக்கைகள் இந்தப் பகுதியில் தாவரப் பரப்பு குறைந்திருக்கலாம் என்று காட்டுகின்றன. இது சாத்தியமான மாற்றம் மட்டுமே; "
                "காரணம் இன்னும் தீர்மானிக்கப்படவில்லை, வனத்துறை நேரில் சரிபார்த்து வருகிறது. உறுதிப்படுத்தப்படாத தகவல்களைப் பகிர வேண்டாம். "
                "உங்களிடம் தகவல் இருந்தால் TerraPulse மூலம் புகைப்படத்துடன் தெரிவிக்கலாம்.")
    else:
        t_en, t_ta = f"Forest safety advisory for the area near {place}", f"{place} அருகிலுள்ள பகுதிக்கான வன பாதுகாப்பு அறிவுரை"
        b_en = ("The dry season increases the risk of forest fires. Please do not light fires or throw cigarettes or glass in or near the forest, "
                "and report any smoke or fire you see. In an emergency call 112.")
        b_ta = ("வறண்ட காலத்தில் காட்டுத்தீ அபாயம் அதிகம். காட்டிலோ அதன் அருகிலோ தீ மூட்ட வேண்டாம்; சிகரெட், கண்ணாடித் துண்டுகளை வீச வேண்டாம். "
                "புகை அல்லது தீயைக் கண்டால் தெரிவிக்கவும். அவசரத்தில் 112-ஐ அழைக்கவும்.")
    if impact_en and kind != "advisory":
        b_en += f" Area information: {impact_en}."
        b_ta += f" பகுதி விவரம்: {impact_ta}."
    return {"title_en": t_en, "title_ta": t_ta, "body_en": b_en + help_en, "body_ta": b_ta + help_ta}


# ---------------------------------------------------------------- delivery
def channels() -> dict[str, bool]:
    return {"in_app": True,
            "telegram": bool(os.getenv("TELEGRAM_BOT_TOKEN") and os.getenv("TELEGRAM_CHAT_ID")),
            "email": bool(os.getenv("ALERT_SMTP_HOST") and os.getenv("ALERT_EMAIL_FROM") and os.getenv("ALERT_EMAIL_TO"))}


def message_text(a: dict[str, Any]) -> str:
    return (f"{DEMO_EN}\n{a['title_en']}\n{a['body_en']}\n\n{DEMO_TA}\n{a['title_ta']}\n{a['body_ta']}")


def _send_telegram(text: str) -> str:
    token, chat = os.getenv("TELEGRAM_BOT_TOKEN"), os.getenv("TELEGRAM_CHAT_ID")
    if not (token and chat):
        return "not configured"
    try:
        r = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", json={"chat_id": chat, "text": text[:4000]}, timeout=10)
        return "sent (DEMO)" if r.status_code == 200 else f"failed (HTTP {r.status_code})"
    except Exception as e:  # noqa: BLE001  (the exception text can contain the token URL, so only its type is reported)
        return f"failed ({type(e).__name__})"


def _send_email(subject: str, text: str) -> str:
    host, frm, to = os.getenv("ALERT_SMTP_HOST"), os.getenv("ALERT_EMAIL_FROM"), os.getenv("ALERT_EMAIL_TO")
    if not (host and frm and to):
        return "not configured"
    try:
        m = EmailMessage()
        m["Subject"], m["From"], m["To"] = f"{DEMO_EN} {subject}", frm, to
        m.set_content(text)
        with smtplib.SMTP(host, int(os.getenv("ALERT_SMTP_PORT", "587")), timeout=10) as s:
            s.starttls()
            if os.getenv("ALERT_SMTP_USER"):
                s.login(os.getenv("ALERT_SMTP_USER", ""), os.getenv("ALERT_SMTP_PASSWORD", ""))
            s.send_message(m)
        return "sent (DEMO)"
    except Exception as e:  # noqa: BLE001
        return f"failed ({type(e).__name__})"


# ------------------------------------------------------------------- rows
def _alert(aid: int) -> dict[str, Any] | None:
    with db.conn() as c:
        r = c.execute("SELECT * FROM community_alerts WHERE id=?", (aid,)).fetchone()
    return dict(r) if r else None


def _view(r: dict[str, Any]) -> dict[str, Any]:
    return {"id": r["id"], "kind": r["kind"], "mode": r["mode"], "source_type": r["source_type"], "source_ref": r["source_ref"], "lat": r["lat"], "lon": r["lon"],
            "radius_km": r["radius_km"], "place": r["place"], "title_en": r["title_en"], "title_ta": r["title_ta"], "body_en": r["body_en"], "body_ta": r["body_ta"],
            "status": r["status"], "created_by": r["created_by"], "reviewed_by": r["reviewed_by"], "review_note": r["review_note"],
            "delivery": json.loads(r["delivery"]), "audit": json.loads(r["audit"]), "created": r["created"], "updated": r["updated"], "demo": True}


def _log(a: dict[str, Any], by: str, event: str, note: str = "") -> str:
    audit = json.loads(a["audit"])
    audit.append({"t": time.time(), "by": by, "event": event, "note": note})
    return json.dumps(audit)


class DraftIn(BaseModel):
    kind: Literal["fire_smoke", "vegetation", "advisory"]
    source_type: Literal["report", "incident", "replay", "manual"] = "manual"
    source_ref: str = Field("", max_length=120)
    lat: float | None = None
    lon: float | None = None
    radius_km: float = Field(5.0, gt=0, le=25)


@router.get("")
def list_alerts():
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM community_alerts ORDER BY id DESC")]
    return {"alerts": [_view(r) for r in rows], "channels": channels(),
            "demo_notice": "Delivery is a DEMO. Nothing here is an official public warning."}


@router.post("/draft")
def draft(body: DraftIn, request: Request):
    lat, lon, mode = body.lat, body.lon, "LIVE"
    if body.source_type == "report":
        try:
            r = _row(int(body.source_ref))
        except ValueError:
            r = None
        if not r:
            raise HTTPException(404, "Citizen report not found")
        lat, lon = r["lat"], r["lon"]
    elif body.source_type == "incident":
        from .core import engine
        rec = next((x for x in engine.records if x["incident_id"] == body.source_ref), None)
        if not rec:
            raise HTTPException(404, "Incident not found")
        lat, lon, mode = rec["lat"], rec["lon"], "HISTORICAL"
    elif body.source_type == "replay":
        mode = "REPLAY"
    if body.kind != "advisory" and (lat is None or lon is None):
        raise HTTPException(422, "A location is needed for this kind of alert.")
    imp = layers.nearby(lat, lon, body.radius_km) if lat is not None and lon is not None else {"status": "unavailable"}
    place = (layers.place_name(lat, lon) if lat is not None and lon is not None else None) or (f"{lat:.3f}°N, {lon:.3f}°E" if lat is not None else "the reserve")
    txt = draft_text(body.kind, place, imp.get("summary_en") if imp.get("status") == "ok" else None, imp.get("summary_ta") if imp.get("status") == "ok" else None)
    now, by = time.time(), request.state.user
    audit = json.dumps([{"t": now, "by": by, "event": "drafted", "note": f"from {body.source_type} {body.source_ref}".strip() + f" · mode {mode}"}])
    with db.conn() as c:
        cur = c.execute("""INSERT INTO community_alerts (kind, mode, source_type, source_ref, lat, lon, radius_km, place, title_en, title_ta, body_en, body_ta,
            status, created_by, audit, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (body.kind, mode, body.source_type, body.source_ref, lat, lon, body.radius_km, place, txt["title_en"], txt["title_ta"], txt["body_en"], txt["body_ta"],
                         "DRAFT", by, audit, now, now))
        aid = cur.lastrowid
    return {"alert": _view(_alert(aid))}  # type: ignore[arg-type]


class EditIn(BaseModel):
    title_en: str = Field(max_length=200)
    title_ta: str = Field(max_length=300)
    body_en: str = Field(max_length=1500)
    body_ta: str = Field(max_length=2500)


@router.post("/{aid}/edit")
def edit(aid: int, body: EditIn, request: Request):
    a = _alert(aid)
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["status"] != "DRAFT":
        raise HTTPException(409, "Only a DRAFT can be edited.")
    with db.conn() as c:
        c.execute("UPDATE community_alerts SET title_en=?, title_ta=?, body_en=?, body_ta=?, audit=?, updated=? WHERE id=?",
                  (body.title_en.strip(), body.title_ta.strip(), body.body_en.strip(), body.body_ta.strip(), _log(a, request.state.user, "edited"), time.time(), aid))
    return {"alert": _view(_alert(aid))}  # type: ignore[arg-type]


class DecideIn(BaseModel):
    note: str = Field("", max_length=500)


@router.post("/{aid}/approve")
def approve(aid: int, body: DecideIn, request: Request):
    a = _alert(aid)
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["status"] != "DRAFT":
        raise HTTPException(409, "Only a DRAFT can be approved.")
    if not all(a[k].strip() for k in ("title_en", "title_ta", "body_en", "body_ta")):
        raise HTTPException(422, "Both the English and the Tamil text must be filled in before approval.")
    hit = sorted({m.group(0).lower() for m in FLAG_WORDS.finditer(json.dumps([a["title_en"], a["body_en"], a["title_ta"], a["body_ta"]], ensure_ascii=False))})
    if hit:
        raise HTTPException(422, "Remove wording about legality or confirmation (" + ", ".join(hit) + "). This prototype only sends alerts about POSSIBLE events.")
    text = message_text(a)
    delivery = {"in_app": "published (DEMO)", "telegram": _send_telegram(text), "email": _send_email(a["title_en"], text)}
    with db.conn() as c:
        c.execute("UPDATE community_alerts SET status='APPROVED', reviewed_by=?, review_note=?, delivery=?, audit=?, updated=? WHERE id=?",
                  (request.state.user, body.note.strip(), json.dumps(delivery), _log(a, request.state.user, "approved and sent (DEMO)", body.note.strip()), time.time(), aid))
    return {"alert": _view(_alert(aid))}  # type: ignore[arg-type]


@router.post("/{aid}/reject")
def reject(aid: int, body: DecideIn, request: Request):
    a = _alert(aid)
    if not a:
        raise HTTPException(404, "Alert not found")
    if a["status"] != "DRAFT":
        raise HTTPException(409, "Only a DRAFT can be rejected.")
    with db.conn() as c:
        c.execute("UPDATE community_alerts SET status='REJECTED', reviewed_by=?, review_note=?, audit=?, updated=? WHERE id=?",
                  (request.state.user, body.note.strip(), _log(a, request.state.user, "rejected", body.note.strip()), time.time(), aid))
    return {"alert": _view(_alert(aid))}  # type: ignore[arg-type]


# ---------------------------------------------------------- citizen side
@citizen_router.get("")
def citizen_alerts():
    """Approved alerts only (never drafts, rejected alerts or the audit trail)."""
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM community_alerts WHERE status='APPROVED' ORDER BY id DESC LIMIT 20")]
    return {"alerts": [{"id": r["id"], "kind": r["kind"], "mode": r["mode"], "place": r["place"], "title_en": r["title_en"], "title_ta": r["title_ta"],
                        "body_en": r["body_en"], "body_ta": r["body_ta"], "created": r["updated"], "demo": True} for r in rows],
            "demo_notice": "DEMO – NOT AN OFFICIAL ALERT"}
