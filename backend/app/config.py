import os
from pathlib import Path
from dotenv import load_dotenv

BASE = Path(__file__).resolve().parent.parent
load_dotenv(BASE / ".env")

MODEL_PATH = Path(os.getenv("TERRAPULSE_MODEL", BASE / "model" / "TerraPulse_RF_200.joblib"))
CSV_PATH = Path(os.getenv("TERRAPULSE_CSV", BASE / "data" / "TerraPulse_Forest_Disturbance_Evidence.csv"))
DB_PATH = Path(os.getenv("TERRAPULSE_DB", BASE / "terrapulse.db"))

ML_THRESHOLD = float(os.getenv("TERRAPULSE_ML_THRESHOLD", "0.5"))
THERMAL_THRESHOLD_K = float(os.getenv("TERRAPULSE_THERMAL_THRESHOLD_K", "330"))
VEG_Z_THRESHOLD = float(os.getenv("TERRAPULSE_VEG_Z", "-1.5"))

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
GEMINI_FALLBACK_MODELS = [m.strip() for m in os.getenv("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash,gemini-2.5-flash-lite").split(",") if m.strip()]
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

STUDY_AREA = "Mudumalai Tiger Reserve, India"
