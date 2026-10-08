import json
import sqlite3
import time
from contextlib import contextmanager
from typing import Any

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS incident_state (incident_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS investigations (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT NOT NULL, scenario TEXT NOT NULL,
  result TEXT NOT NULL, prompt_user TEXT NOT NULL, model TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, incident_id TEXT NOT NULL, body TEXT NOT NULL, created REAL NOT NULL);
"""


@contextmanager
def conn():
    c = sqlite3.connect(config.DB_PATH)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


def states() -> dict[str, dict[str, Any]]:
    with conn() as c:
        return {r["incident_id"]: dict(r) for r in c.execute("SELECT * FROM incident_state")}


def set_status(incident_id: str, status: str) -> None:
    with conn() as c:
        c.execute("INSERT INTO incident_state VALUES (?,?,?) ON CONFLICT(incident_id) DO UPDATE SET status=excluded.status, updated=excluded.updated",
                  (incident_id, status, time.time()))


def get_status(incident_id: str) -> str:
    with conn() as c:
        r = c.execute("SELECT status FROM incident_state WHERE incident_id=?", (incident_id,)).fetchone()
        return r["status"] if r else "NEW"


def save_investigation(incident_id: str, scenario: str, result: dict, prompt_user: str, model: str) -> dict:
    now = time.time()
    with conn() as c:
        cur = c.execute("INSERT INTO investigations (incident_id,scenario,result,prompt_user,model,created) VALUES (?,?,?,?,?,?)",
                        (incident_id, scenario, json.dumps(result), prompt_user, model, now))
        return {"id": cur.lastrowid, "incident_id": incident_id, "scenario": scenario, "result": result, "model": model, "created": now}


def latest_investigations(incident_id: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    with conn() as c:
        for r in c.execute("SELECT * FROM investigations WHERE incident_id=? ORDER BY id", (incident_id,)):
            out[r["scenario"]] = {"id": r["id"], "scenario": r["scenario"], "result": json.loads(r["result"]), "model": r["model"], "created": r["created"]}
    return out


def investigated_ids() -> set[str]:
    with conn() as c:
        return {r["incident_id"] for r in c.execute("SELECT DISTINCT incident_id FROM investigations")}


def add_chat(incident_id: str, role: str, content: str) -> None:
    with conn() as c:
        c.execute("INSERT INTO chats (incident_id,role,content,created) VALUES (?,?,?,?)", (incident_id, role, content, time.time()))


def get_chat(incident_id: str) -> list[dict]:
    with conn() as c:
        return [{"role": r["role"], "content": r["content"], "created": r["created"]} for r in c.execute("SELECT * FROM chats WHERE incident_id=? ORDER BY id", (incident_id,))]


def save_report(incident_id: str, body: dict) -> dict:
    now = time.time()
    with conn() as c:
        cur = c.execute("INSERT INTO reports (incident_id,body,created) VALUES (?,?,?)", (incident_id, json.dumps(body), now))
        return {"id": cur.lastrowid, "incident_id": incident_id, "created": now, "body": body}


def list_reports() -> list[dict]:
    with conn() as c:
        return [{"id": r["id"], "incident_id": r["incident_id"], "created": r["created"]} for r in c.execute("SELECT * FROM reports ORDER BY id DESC")]


def get_report(rid: int) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM reports WHERE id=?", (rid,)).fetchone()
        return {"id": r["id"], "incident_id": r["incident_id"], "created": r["created"], "body": json.loads(r["body"])} if r else None
