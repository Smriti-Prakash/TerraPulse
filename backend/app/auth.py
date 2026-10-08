"""Forest-office sign-in: users table, password hashing, signed tokens, route protection.

Standard library only (hashlib / hmac), no extra packages.
Configure in backend/.env:
  OFFICE_USERNAME, OFFICE_PASSWORD, OFFICE_NAME   office account (created / updated at startup)
  AUTH_SECRET                                     signs tokens; if unset a random one is made per start
  AUTH_TOKEN_HOURS                                token lifetime, default 8
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import re
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from . import config, db  # config import also loads backend/.env

DEMO_USERNAME = "forest.officer"
DEMO_PASSWORD = "Terrapulse@2026"
PUBLIC_PATHS = {"/api/health", "/api/auth/login", "/api/auth/register"}
CITIZEN_PREFIX = "/api/citizen/"  # the only data routes a citizen account may call (plus /api/auth/me)

TOKEN_HOURS = float(os.getenv("AUTH_TOKEN_HOURS", "8"))
SECRET = (os.getenv("AUTH_SECRET", "").strip() or secrets.token_hex(32)).encode()
PBKDF2_ROUNDS = 200_000
MAX_FAILS, FAIL_WINDOW_S = 5, 300

router = APIRouter(prefix="/api/auth", tags=["auth"])
_fails: dict[str, list[float]] = {}


# ---------------------------------------------------------------- passwords
def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, want = stored.split("$")
        got = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        return hmac.compare_digest(got, want)
    except Exception:
        return False


_DUMMY_HASH = hash_password("not-a-real-password")  # keeps timing similar for unknown users


# ------------------------------------------------------------------- tokens
def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(username: str) -> tuple[str, float]:
    exp = time.time() + TOKEN_HOURS * 3600
    body = _b64(json.dumps({"u": username, "exp": exp}).encode())
    sig = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}", exp


def read_token(token: str) -> str | None:
    try:
        body, sig = token.split(".")
        want = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, want):
            return None
        data = json.loads(_unb64(body))
        return data["u"] if data["exp"] > time.time() else None
    except Exception:
        return None


# -------------------------------------------------------------------- users
USERS_SCHEMA = """CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, display_name TEXT NOT NULL,
  role TEXT NOT NULL, pw_hash TEXT NOT NULL, created REAL NOT NULL);"""


def init() -> None:
    """Create the users table and the office account. Called at startup."""
    env_user = os.getenv("OFFICE_USERNAME", "").strip()
    env_pass = os.getenv("OFFICE_PASSWORD", "")
    name = os.getenv("OFFICE_NAME", "").strip() or "Forest Office"
    username = (env_user or DEMO_USERNAME).lower()
    with db.conn() as c:
        c.execute(USERS_SCHEMA)
        exists = c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone()
        if env_pass:  # configured in .env: always keep the stored hash in sync with it
            h = hash_password(env_pass)
            c.execute("INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET pw_hash=excluded.pw_hash, display_name=excluded.display_name, role='officer'",
                      (username, name, "officer", h, time.time()))
        elif not exists:
            c.execute("INSERT INTO users VALUES (?,?,?,?,?)", (username, name, "officer", hash_password(DEMO_PASSWORD), time.time()))
    if not env_pass:
        print(f"[auth] WARNING: OFFICE_PASSWORD is not set in .env, so the built-in demo account '{username}' is active. "
              "Set OFFICE_USERNAME and OFFICE_PASSWORD in backend/.env to change it.")


def get_user(username: str) -> dict | None:
    with db.conn() as c:
        r = c.execute("SELECT username, display_name, role FROM users WHERE username=?", (username.lower(),)).fetchone()
        return {"username": r["username"], "name": r["display_name"], "role": r["role"]} if r else None


def _stored_hash(username: str) -> str | None:
    with db.conn() as c:
        r = c.execute("SELECT pw_hash FROM users WHERE username=?", (username.lower(),)).fetchone()
        return r["pw_hash"] if r else None


# ------------------------------------------------------------ route guarding
def require_user(request: Request) -> None:
    """Global dependency: every /api route needs a valid token except PUBLIC_PATHS."""
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/") or path in PUBLIC_PATHS:
        return
    header = request.headers.get("authorization", "")
    username = read_token(header[7:]) if header.lower().startswith("bearer ") else None
    user = get_user(username) if username else None
    if not user:
        raise HTTPException(401, "Sign in required")
    if user["role"] == "citizen" and path != "/api/auth/me" and not path.startswith(CITIZEN_PREFIX):
        raise HTTPException(403, "This account can only submit and view its own reports.")
    request.state.user = user["username"]
    request.state.role = user["role"]
    request.state.name = user["name"]


# ---------------------------------------------------------------- endpoints
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


@router.post("/login")
def login(body: LoginIn, request: Request):
    username = body.username.strip().lower()
    key = f"{request.client.host if request.client else '?'}|{username}"
    now = time.time()
    recent = [t for t in _fails.get(key, []) if now - t < FAIL_WINDOW_S]
    if len(recent) >= MAX_FAILS:
        wait = int(FAIL_WINDOW_S - (now - recent[0])) + 1
        raise HTTPException(429, f"Too many failed attempts. Try again in {wait} seconds.")
    stored = _stored_hash(username)
    good = verify_password(body.password, stored or _DUMMY_HASH) and stored is not None
    if not good:
        _fails[key] = recent + [now]
        raise HTTPException(401, "Incorrect username or password")
    _fails.pop(key, None)
    token, exp = make_token(username)
    return {"token": token, "expires": exp, "user": get_user(username)}


_reg: dict[str, list[float]] = {}
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=8, max_length=128)


@router.post("/register")
def register(body: RegisterIn, request: Request):
    """Self-service sign-up. Always creates a CITIZEN account; officer accounts are never created here."""
    ip = request.client.host if request.client else "?"
    now = time.time()
    recent = [t for t in _reg.get(ip, []) if now - t < 3600]
    if len(recent) >= 5:
        raise HTTPException(429, "Too many sign-ups from this device. Try again later.")
    username = body.username.strip().lower()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "Username must be 3-32 characters: letters, numbers, dot, dash or underscore.")
    if body.password.lower() == username:
        raise HTTPException(422, "Password must not be the same as the username.")
    with db.conn() as c:
        if c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            raise HTTPException(409, "That username is already taken.")
        c.execute("INSERT INTO users VALUES (?,?,?,?,?)", (username, body.name.strip(), "citizen", hash_password(body.password), now))
    _reg[ip] = recent + [now]
    token, exp = make_token(username)
    return {"token": token, "expires": exp, "user": get_user(username)}


@router.get("/me")
def me(request: Request):
    return {"user": get_user(request.state.user)}
