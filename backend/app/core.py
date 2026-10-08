"""Data, ML, evidence interpretation, risk and incident logic.

Everything here is derived from the supplied CSV and the supplied .joblib model.
Nothing is simulated.
"""
from __future__ import annotations

import json
import math
import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from . import config

FEATURES = ["NDVI", "NBR", "VV", "VH", "Fire_Brightness", "Temperature", "Rainfall", "Forest"]
UNAVAILABLE = "Data unavailable in current prototype"

# Units are NOT stored in the files; these are inferences from names/value ranges.
FEATURE_META = {
    "NDVI": {"label": "NDVI", "unit": "index", "unit_note": "Unitless vegetation index (range −1…1)."},
    "NBR": {"label": "NBR", "unit": "index", "unit_note": "Unitless burn/vegetation index (range −1…1)."},
    "VV": {"label": "Sentinel-1 VV", "unit": "dB", "unit_note": "Unit not stated in file; values are consistent with backscatter in dB."},
    "VH": {"label": "Sentinel-1 VH", "unit": "dB", "unit_note": "Unit not stated in file; values are consistent with backscatter in dB."},
    "Fire_Brightness": {"label": "Fire / thermal brightness", "unit": "K", "unit_note": "Unit not stated in file; values are consistent with a VIIRS-type brightness temperature in kelvin. Date, confidence and FRP are not in the file."},
    "Temperature": {"label": "Temperature", "unit": "K", "unit_note": "Unit not stated in file; values are consistent with kelvin."},
    "Rainfall": {"label": "Rainfall", "unit": "unspecified", "unit_note": "Unit and accumulation period are not stated in the file."},
    "Forest": {"label": "Forest indicator", "unit": "0/1", "unit_note": "Binary flag (1 = forest, 0 = not forest) as supplied."},
}

DATA_GAPS = [
    "Observation date/time (the CSV has no timestamp)",
    "Reference (baseline) vs current NDVI/NBR, so temporal vegetation change cannot be computed",
    "Time series of any variable",
    "Fire detection confidence, fire radiative power and acquisition time",
    "Wind speed/direction, air quality (AQI), smoke dispersion",
    "Nearby settlements / population",
    "Ground-truth or field verification",
]

COMMUNITY_STATEMENT = "Community exposure cannot be determined with the currently available data."

RISK_RULE = {
    "summary": "Score = ML disturbance (2 pts) + thermal signal (1 pt) + vegetation anomaly (1 pt). Level: 0–1 LOW, 2 MODERATE, 3 HIGH, 4 CRITICAL.",
    "signals": [
        {"name": "ML disturbance detected", "points": 2,
         "test": f"Random Forest probability of class 1 ≥ {config.ML_THRESHOLD} (the model's own majority-vote decision)."},
        {"name": "Thermal signal present", "points": 1,
         "test": f"Fire_Brightness ≥ {config.THERMAL_THRESHOLD_K:g} K. A screening heuristic (typical VIIRS I-4 fire pixels are well above background), NOT a confirmed fire."},
        {"name": "Vegetation anomaly (spatial)", "points": 1,
         "test": f"NDVI or NBR robust z-score ≤ {config.VEG_Z_THRESHOLD:g} relative to the other sampled points (median/MAD). This is a spatial comparison, not a temporal change."},
    ],
    "levels": {"0-1": "LOW", "2": "MODERATE", "3": "HIGH", "4": "CRITICAL"},
    "note": "An incident is opened only when at least one signal is present. Observations with no signal stay in Forest Monitor.",
}


class DataError(RuntimeError):
    pass


def _level(score: int) -> str:
    return ["LOW", "LOW", "MODERATE", "HIGH", "CRITICAL"][score]


def _f(x: Any) -> float:
    return float(x)


@dataclass
class Engine:
    model: Any = None
    df: pd.DataFrame | None = None
    errors: list[str] = field(default_factory=list)
    ref: dict[str, dict[str, float]] = field(default_factory=dict)
    model_info: dict[str, Any] = field(default_factory=dict)
    records: list[dict[str, Any]] = field(default_factory=list)

    # ------------------------------------------------------------------ load
    def load(self) -> None:
        self.errors = []
        self._load_model()
        self._load_csv()
        if self.df is not None:
            self._build_reference()
            self._build_records()

    def _load_model(self) -> None:
        import joblib

        if not config.MODEL_PATH.exists():
            self.errors.append(f"Model file not found: {config.MODEL_PATH}")
            return
        try:
            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                m = joblib.load(config.MODEL_PATH)
            version_warn = [str(x.message).split("\n")[0] for x in w if "InconsistentVersion" in x.category.__name__]
        except Exception as e:  # noqa: BLE001
            self.errors.append(f"Could not load model: {e}")
            return
        names = list(getattr(m, "feature_names_in_", []))
        if names != FEATURES:
            self.errors.append(f"Model features {names} differ from expected {FEATURES}")
            return
        if not hasattr(m, "predict_proba"):
            self.errors.append("Model has no predict_proba")
            return
        self.model = m
        imp = getattr(m, "feature_importances_", None)
        self.model_info = {
            "type": type(m).__name__,
            "n_estimators": int(getattr(m, "n_estimators", 0)),
            "classes": [int(c) for c in m.classes_],
            "features": names,
            "feature_importances": {n: round(float(v), 4) for n, v in zip(names, imp)} if imp is not None else {},
            "decision_threshold": config.ML_THRESHOLD,
            "sklearn_version_warning": version_warn[0] if version_warn else None,
            "class_meaning_note": "Class 1 is treated as 'potential forest disturbance' as stated by the project team; the .joblib file does not store class names.",
        }

    def _load_csv(self) -> None:
        if not config.CSV_PATH.exists():
            self.errors.append(f"CSV file not found: {config.CSV_PATH}")
            return
        try:
            df = pd.read_csv(config.CSV_PATH)
        except Exception as e:  # noqa: BLE001
            self.errors.append(f"Could not read CSV: {e}")
            return
        need = set(FEATURES) | {".geo", "system:index"}
        miss = need - set(df.columns)
        if miss:
            self.errors.append(f"CSV is missing required columns: {sorted(miss)}")
            return
        coords = []
        bad = []
        for i, g in enumerate(df[".geo"]):
            try:
                gj = json.loads(g)
                lon, lat = gj["coordinates"][:2]
                if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                    raise ValueError("out of range")
                coords.append((float(lon), float(lat)))
            except Exception:  # noqa: BLE001
                coords.append((math.nan, math.nan))
                bad.append(int(i))
        df["lon"] = [c[0] for c in coords]
        df["lat"] = [c[1] for c in coords]
        if bad:
            self.errors.append(f"Invalid coordinates in CSV rows {bad}; those rows are excluded from the map.")
        feat_bad = df[FEATURES].isna().any(axis=1) | ~np.isfinite(df[FEATURES].to_numpy(dtype=float)).all(axis=1)
        if feat_bad.any():
            self.errors.append(f"Rows with missing/non-finite features excluded: {list(np.where(feat_bad)[0])}")
            df = df[~feat_bad].reset_index(drop=True)
        self.df = df

    # ------------------------------------------------------------ reference
    def _build_reference(self) -> None:
        assert self.df is not None
        for c in ["NDVI", "NBR", "VV", "VH", "Fire_Brightness", "Temperature", "Rainfall"]:
            s = self.df[c].astype(float)
            med = float(s.median())
            mad = float((s - med).abs().median())
            self.ref[c] = {"median": med, "mad": mad, "min": float(s.min()), "max": float(s.max()),
                           "std": float(s.std(ddof=0))}

    def robust_z(self, name: str, value: float) -> float | None:
        r = self.ref.get(name)
        if not r:
            return None
        scale = 1.4826 * r["mad"]
        if scale <= 1e-12:
            scale = r["std"]
        if scale <= 1e-12:
            return None
        return (value - r["median"]) / scale

    # -------------------------------------------------------------- predict
    def predict(self, feats: dict[str, float]) -> dict[str, Any]:
        if self.model is None:
            raise DataError("ML model is not loaded: " + "; ".join(self.errors))
        X = pd.DataFrame([[feats[f] for f in FEATURES]], columns=FEATURES)
        proba = self.model.predict_proba(X)[0]
        classes = [int(c) for c in self.model.classes_]
        p1 = float(proba[classes.index(1)])
        cls = int(self.model.predict(X)[0])
        detected = p1 >= config.ML_THRESHOLD
        return {"probability": p1, "predicted_class": cls, "disturbance_detected": bool(detected),
                "threshold": config.ML_THRESHOLD, "trees": self.model_info.get("n_estimators"),
                "vote_resolution": 1.0 / max(1, self.model_info.get("n_estimators", 1))}

    # ----------------------------------------------------------------- risk
    def assess(self, feats: dict[str, float], pred: dict[str, Any]) -> dict[str, Any]:
        thermal = feats["Fire_Brightness"] >= config.THERMAL_THRESHOLD_K
        zn = self.robust_z("NDVI", feats["NDVI"])
        zb = self.robust_z("NBR", feats["NBR"])
        veg = any(z is not None and z <= config.VEG_Z_THRESHOLD for z in (zn, zb))
        ml = bool(pred["disturbance_detected"])
        pts = {"ml": 2 if ml else 0, "thermal": 1 if thermal else 0, "vegetation": 1 if veg else 0}
        score = sum(pts.values())
        level = _level(score)
        reasons, not_reasons = [], []
        p = pred["probability"]
        if ml:
            reasons.append(f"Random Forest flags disturbance (probability {p:.3f} ≥ {config.ML_THRESHOLD}).")
        else:
            not_reasons.append(f"Random Forest does NOT flag disturbance (probability {p:.3f} < {config.ML_THRESHOLD}).")
        if thermal:
            reasons.append(f"Thermal signal present: Fire_Brightness {feats['Fire_Brightness']:g} K ≥ {config.THERMAL_THRESHOLD_K:g} K (screening heuristic, not a confirmed fire).")
        else:
            not_reasons.append(f"No thermal signal: Fire_Brightness {feats['Fire_Brightness']:g} K < {config.THERMAL_THRESHOLD_K:g} K.")
        if veg:
            low = []
            if zn is not None and zn <= config.VEG_Z_THRESHOLD:
                low.append(f"NDVI {feats['NDVI']:.3f} (z={zn:.2f})")
            if zb is not None and zb <= config.VEG_Z_THRESHOLD:
                low.append(f"NBR {feats['NBR']:.3f} (z={zb:.2f})")
            reasons.append("Vegetation anomaly vs other sampled points (spatial, not temporal): " + ", ".join(low) + ".")
        else:
            not_reasons.append("No vegetation anomaly relative to the other sampled points.")
        return {
            "score": score, "max_score": 4, "level": level, "points": pts,
            "signals": {"ml_detected": ml, "thermal_signal": bool(thermal), "vegetation_anomaly": bool(veg)},
            "reasons": reasons, "not_triggered": not_reasons,
            "rule": RISK_RULE["summary"],
            "z": {"NDVI": zn, "NBR": zb},
            "is_incident": score >= 1,
        }

    # ------------------------------------------------------------- records
    def _build_records(self) -> None:
        assert self.df is not None
        recs = []
        n_inc = 0
        for i, row in self.df.iterrows():
            feats = {f: _f(row[f]) for f in FEATURES}
            pred = self.predict(feats) if self.model is not None else None
            risk = self.assess(feats, pred) if pred else None
            rec = {
                "row": int(i),
                "csv_row_number": int(i) + 2,  # header is line 1
                "system_index": str(row["system:index"]),
                "lon": None if math.isnan(row["lon"]) else float(row["lon"]),
                "lat": None if math.isnan(row["lat"]) else float(row["lat"]),
                "features": feats,
                "csv_disturbance_probability": _f(row["Disturbance_Probability"]) if "Disturbance_Probability" in self.df.columns else None,
                "ml": pred,
                "risk": risk,
                "incident_id": None,
            }
            if risk and risk["is_incident"]:
                n_inc += 1
                rec["incident_id"] = f"TP-{int(i) + 1:03d}"
            recs.append(rec)
        for r in recs:
            r["cluster"] = self._cluster(r)
        self.records = recs

    @staticmethod
    def _cluster(r: dict[str, Any]) -> str | None:
        if r["lat"] is None:
            return None
        return "North cluster (~11.65°N)" if r["lat"] >= 11.6 else "South cluster (~11.54°N)"

    # -------------------------------------------------------------- access
    def get_record(self, incident_id: str) -> dict[str, Any] | None:
        for r in self.records:
            if r["incident_id"] == incident_id or f"TP-{r['row'] + 1:03d}" == incident_id:
                return r
        return None

    def evidence(self, rec: dict[str, Any]) -> dict[str, Any]:
        f = rec["features"]
        risk = rec["risk"]
        zs = {k: self.robust_z(k, f[k]) for k in ("NDVI", "NBR", "VV", "VH")}
        signals = []
        for k in FEATURES:
            m = FEATURE_META[k]
            item = {"key": k, "label": m["label"], "value": f[k], "unit": m["unit"], "unit_note": m["unit_note"]}
            if k in self.ref:
                r = self.ref[k]
                item["sample_median"] = r["median"]
                item["sample_min"] = r["min"]
                item["sample_max"] = r["max"]
                item["robust_z"] = self.robust_z(k, f[k])
            signals.append(item)
        temp_c = f["Temperature"] - 273.15
        return {
            "signals": signals,
            "derived": {"Temperature_celsius": temp_c},
            "vegetation": {
                "reference_value": UNAVAILABLE, "current_value": UNAVAILABLE, "change": UNAVAILABLE,
                "spatial_context": {
                    "NDVI": {"value": f["NDVI"], "sample_median": self.ref["NDVI"]["median"], "robust_z": zs["NDVI"]},
                    "NBR": {"value": f["NBR"], "sample_median": self.ref["NBR"]["median"], "robust_z": zs["NBR"]},
                    "note": "Compared with the other sampled points at unknown acquisition time. This is NOT temporal vegetation change.",
                },
            },
            "fire": {
                "thermal_signal_present": risk["signals"]["thermal_signal"],
                "fire_brightness_K": f["Fire_Brightness"],
                "threshold_K": config.THERMAL_THRESHOLD_K,
                "label": self._fire_label(rec),
                "confirmed": False,
                "confidence_or_frp": UNAVAILABLE,
                "shared_value_points": int((self.df["Fire_Brightness"] == f["Fire_Brightness"]).sum()) if self.df is not None else None,
            },
            "community": {"status": COMMUNITY_STATEMENT},
            "data_gaps": DATA_GAPS,
        }

    def _fire_label(self, rec: dict[str, Any]) -> str:
        s = rec["risk"]["signals"]
        if s["thermal_signal"] and s["ml_detected"]:
            return "Potential fire-related disturbance (thermal signal + ML disturbance) — unconfirmed"
        if s["thermal_signal"]:
            return "Thermal signal present, but ML does not flag disturbance — fire-related disturbance not supported by current evidence"
        return "No thermal signal in the supplied record"

    def incident_view(self, rec: dict[str, Any], state: dict[str, Any] | None = None) -> dict[str, Any]:
        s = rec["risk"]["signals"]
        tags = []
        if s["thermal_signal"]:
            tags.append("fire-related evidence")
        if s["vegetation_anomaly"]:
            tags.append("vegetation change")
        if s["ml_detected"]:
            tags.append("ml-detected")
        title = "Potential Forest Disturbance" if s["ml_detected"] else (
            "Thermal Signal — ML Below Detection Threshold" if s["thermal_signal"] and not s["vegetation_anomaly"] else
            "Vegetation Anomaly (Spatial) — ML Below Detection Threshold" if s["vegetation_anomaly"] and not s["thermal_signal"] else
            "Thermal Signal + Vegetation Anomaly — ML Below Detection Threshold")
        return {
            "id": rec["incident_id"], "title": title, "location": config.STUDY_AREA, "cluster": rec["cluster"],
            "lat": rec["lat"], "lon": rec["lon"], "csv_row_number": rec["csv_row_number"], "system_index": rec["system_index"],
            "features": rec["features"], "ml": rec["ml"], "csv_disturbance_probability": rec["csv_disturbance_probability"],
            "risk": rec["risk"], "tags": tags,
            "status": (state or {}).get("status", "NEW"),
            "ml_assessment": "Potential disturbance" if s["ml_detected"] else "No disturbance detected (below threshold)",
            "data_mode": "HISTORICAL DATA — not a live feed",
        }

    def dashboard(self) -> dict[str, Any]:
        recs = self.records
        inc = [r for r in recs if r["incident_id"]]
        by = {k: 0 for k in ("LOW", "MODERATE", "HIGH", "CRITICAL")}
        for r in inc:
            by[r["risk"]["level"]] += 1
        probs = [r["ml"]["probability"] for r in recs]
        csvp = [r["csv_disturbance_probability"] for r in recs if r["csv_disturbance_probability"] is not None]
        diffs = [abs(r["ml"]["probability"] - r["csv_disturbance_probability"]) for r in recs if r["csv_disturbance_probability"] is not None]
        return {
            "observations": len(recs),
            "ml_detected": sum(1 for r in recs if r["ml"]["disturbance_detected"]),
            "ml_threshold": config.ML_THRESHOLD,
            "ml_prob_max": max(probs), "ml_prob_min": min(probs), "ml_prob_mean": float(np.mean(probs)),
            "csv_prob_max": max(csvp) if csvp else None,
            "csv_vs_model_max_abs_diff": max(diffs) if diffs else None,
            "incidents": len(inc),
            "by_risk": by,
            "thermal_signal": sum(1 for r in recs if r["risk"]["signals"]["thermal_signal"]),
            "vegetation_anomaly": sum(1 for r in recs if r["risk"]["signals"]["vegetation_anomaly"]),
            "non_forest": sum(1 for r in recs if r["features"]["Forest"] == 0),
            "model": self.model_info,
            "data_mode": "HISTORICAL DATA — not a live feed",
            "study_area": config.STUDY_AREA,
        }

    def demo_records(self) -> dict[str, Any]:
        """Select real records for the demos by an explicit, documented rule."""
        inc = [r for r in self.records if r["incident_id"]]
        out: dict[str, Any] = {}
        # Fire/thermal demo: thermal signal present; highest RF probability among them.
        th = [r for r in inc if r["risk"]["signals"]["thermal_signal"]]
        if th:
            r = max(th, key=lambda x: x["ml"]["probability"])
            out["fire"] = {"incident_id": r["incident_id"], "rule": "Among records with a thermal signal (Fire_Brightness ≥ threshold), the one with the highest Random Forest probability."}
        # Vegetation demo: most negative NDVI robust z.
        veg = [r for r in inc if r["risk"]["signals"]["vegetation_anomaly"]]
        if veg:
            r = min(veg, key=lambda x: (x["risk"]["z"]["NDVI"] if x["risk"]["z"]["NDVI"] is not None else 0))
            out["vegetation"] = {"incident_id": r["incident_id"], "rule": "Among records with a vegetation anomaly, the one with the lowest NDVI relative to the sample (most negative robust z)."}
        if inc:
            r = max(inc, key=lambda x: (x["risk"]["score"], x["ml"]["probability"]))
            out["top"] = {"incident_id": r["incident_id"], "rule": "Highest risk score, ties broken by Random Forest probability."}
        return out


engine = Engine()
