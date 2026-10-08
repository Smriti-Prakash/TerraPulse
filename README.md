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
- **Sign in:** the site opens on a Forest Office login. Set `OFFICE_USERNAME` and `OFFICE_PASSWORD` in `backend\.env`. If `OFFICE_PASSWORD` is empty, a built-in demo account is used (username `forest.officer`, password `Terrapulse@2026`) and the backend prints a warning. Set your own before sharing the site.
- Without GEMINI_API_KEY everything works except AI investigation/chat, which show a clear error.
- Risk rule, thresholds and data gaps: Risk & Alerts page, `backend/app/core.py`.
- Backend tests: `cd backend; python tests\test_api.py` (uses a local Gemini stub; no key needed; includes sign-in checks).
