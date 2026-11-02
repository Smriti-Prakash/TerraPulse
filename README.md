# TerraPulse – GenAI-Powered Forest Intelligence, Investigation and Response Platform
Study area: Mudumalai Tiger Reserve. React + Vite + TS + Tailwind frontend, FastAPI backend (Random Forest `.joblib` + Gemini), SQLite.
Data mode: HISTORICAL (27 real CSV records). Not a live feed.

## Run on Windows (beginner-friendly)
Prerequisites: **Python 3.11 or 3.12** (python.org; tick "Add to PATH") and **Node.js 20 or newer** (nodejs.org). A Gemini key from https://aistudio.google.com/apikey.

### 1. Backend (PowerShell, window 1)
```
cd terrapulse\backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
notepad .env          # paste your key after GEMINI_API_KEY= and save
uvicorn app.main:app --port 8000
```
If activation is blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then retry.
Check http://127.0.0.1:8000/api/health : `model_loaded` and `csv_loaded` must be true.
(scikit-learn is pinned to 1.8.0 because the model was saved with it.)

### 2. Frontend (PowerShell, window 2)
```
cd terrapulse\frontend
npm install
npm run dev
```
Open **http://localhost:5173**. The map needs internet for satellite tiles.

## Notes
- Without GEMINI_API_KEY everything works except AI investigation/chat, which show a clear error.
- Risk rule, thresholds and data gaps: Risk & Alerts page, `backend/app/core.py`.
- Backend tests: `cd backend; python tests\test_api.py` (uses a local Gemini stub; no key needed).

## New website features (Review-2 update)
Pages: Change over time, Fire season, Community alerts (officer approval, English + Tamil, DEMO delivery), Replay (real past FIRMS event), public `/safety` page, Tamil citizen app.
Every screen carries a LIVE / HISTORICAL / REPLAY / SIMULATION / DEMO tag. Features that need outside data read optional files in `backend/data/` and otherwise say "Data unavailable in current prototype":

| File | Made by | Used for |
|---|---|---|
| `fire_detections.csv` | `python tools/fetch_firms.py --start 2018-01-01 --end 2025-12-31` (free FIRMS key) | fire cross-check, fire season, replay |
| `osm_layers.json` | `python tools/fetch_osm_layers.py` | settlements, schools, water, roads near a report/incident |
| `change_series.csv`, `hansen_loss.csv` | `python tools/make_change_series_script.py`, paste `tools/ee_change_series.js` into Earth Engine, run both exports | Change over time, Hansen supporting evidence |
| `reserve_boundary.geojson` | optional | inside/outside reserve check |

Demo alert channels (optional, in `backend/.env`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ALERT_SMTP_*`, `ALERT_HELPLINE` (see `.env.example`). Delivered text always starts with a DEMO prefix.
Tests: `python tests\test_api.py`, `python tests\test_citizen.py`, `python tests\test_website.py`.
