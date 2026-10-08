"""Thin Gemini REST client (backend only; the key never reaches the browser)."""
from __future__ import annotations

import json
import re
import time
from typing import Any

import httpx

from . import config


class GeminiError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _endpoint(model: str) -> str:
    return f"{config.GEMINI_BASE_URL}/models/{model}:generateContent"


RETRY_STATUS = {429, 500, 502, 503, 504}


def generate(system: str, contents: list[dict[str, Any]], json_mode: bool, temperature: float = 0.2) -> str:
    if not config.GEMINI_API_KEY:
        raise GeminiError("GEMINI_API_KEY is not set. Add it to backend/.env and restart the backend.", 503)
    body: dict[str, Any] = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": temperature, "maxOutputTokens": 8192},
    }
    if json_mode:
        body["generationConfig"]["responseMimeType"] = "application/json"
    models = [config.GEMINI_MODEL] + [m for m in config.GEMINI_FALLBACK_MODELS if m != config.GEMINI_MODEL]
    r = None
    last = ""
    for model in models:
        for attempt in range(3):
            try:
                r = httpx.post(_endpoint(model), json=body, headers={"x-goog-api-key": config.GEMINI_API_KEY}, timeout=90.0)
            except httpx.HTTPError as e:
                last = f"Could not reach Gemini API: {e}"
                r = None
            else:
                if r.status_code == 200:
                    break
                try:
                    last = f"Gemini API error {r.status_code}: " + r.json().get("error", {}).get("message", r.text[:300])
                except Exception:  # noqa: BLE001
                    last = f"Gemini API error {r.status_code}: {r.text[:300]}"
                if r.status_code not in RETRY_STATUS:
                    raise GeminiError(last, 400 if r.status_code in (400, 404) else 502)
            time.sleep(1.5 * (attempt + 1))  # backoff: 1.5s, 3s, 4.5s
        if r is not None and r.status_code == 200:
            break
    if r is None or r.status_code != 200:
        if r is None:
            raise GeminiError(last or "Could not reach Gemini API.")
        raise GeminiError("Gemini is busy right now (high demand). Please wait a minute and click Investigate again. Details: " + last)
    try:
        data = r.json()
        cand = data["candidates"][0]
        text = "".join(p.get("text", "") for p in cand["content"]["parts"])
    except Exception as e:  # noqa: BLE001
        raise GeminiError(f"Unexpected Gemini response shape: {str(r.text)[:300]}") from e
    if not text.strip():
        raise GeminiError("Gemini returned an empty response (possibly blocked by safety filters).")
    return text


def parse_json(text: str) -> dict[str, Any]:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        v = json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, re.S)
        if not m:
            raise GeminiError("Gemini did not return JSON: " + t[:200])
        try:
            v = json.loads(m.group(0))
        except json.JSONDecodeError as e:
            raise GeminiError("Gemini returned malformed JSON: " + str(e)) from e
    if not isinstance(v, dict):
        raise GeminiError("Gemini JSON was not an object.")
    return v
