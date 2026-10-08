"""
TerraPulse - train and evaluate a vegetation-loss model.

Input : data/terrapulse_training_points.csv   (from 01_export_training_data.js)
Output: out/metrics.json, out/model_card.md, out/feature_importance.csv,
        out/TerraPulse_Loss_Model.joblib   (only written if --save is given)

What the model predicts
    "Is there satellite-derived tree-cover loss at this point in this year?"  (Hansen label)
It does NOT say what caused the loss, and it says nothing about legality.
Cause attribution (fire / drought / possible clearing) stays in the rule layer.

How it is evaluated (the part that makes the numbers trustworthy)
    1. Spatial CV      - whole map cells are held out, so neighbouring pixels never sit in train and test.
    2. Temporal holdout - train on earlier years, test on the latest year.
    3. Honest base rate - scores are reported on the RANDOM sample only; the loss-oversample points are
                          used for training but excluded from the headline numbers.
    4. Baseline        - a plain rule "NDVI dropped by more than X" must be beaten, or we say it was not.
"""
import argparse, json, sys, warnings
from pathlib import Path
import numpy as np, pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import GroupKFold

warnings.filterwarnings("ignore", category=UserWarning)
HERE = Path(__file__).parent
FEATURES = ["d_ndvi", "d_nbr", "ndvi_before", "nbr_before", "d_vv", "d_vh",
            "rain_anom", "temp_change", "fire_days", "elevation", "slope"]
CELL_DEG = 0.02          # ~2 km spatial blocks
SEED = 42


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    need = set(FEATURES + ["year", "lon", "lat", "lost_in_year", "lost_before", "stratum", "point_id"])
    miss = need - set(df.columns)
    if miss:
        sys.exit(f"CSV is missing columns: {sorted(miss)}")
    n0 = len(df)
    for c in ("lost_in_year", "lost_before"):
        df[c] = df[c].astype(str).str.lower().isin(["1", "1.0", "true"])
    df = df[~df["lost_before"]]                                   # already lost in an earlier year
    df = df.dropna(subset=["d_ndvi", "d_nbr"])                    # no clear satellite view in one window
    df["fire_days"] = df["fire_days"].fillna(0)
    df = df.dropna(subset=FEATURES)
    df["cell"] = (np.floor(df["lon"] / CELL_DEG).astype(int).astype(str) + "_" + np.floor(df["lat"] / CELL_DEG).astype(int).astype(str))
    print(f"rows: {n0} -> {len(df)} after dropping already-lost points and rows without a clear view")
    return df


def metrics(y, p, thr):
    if y.sum() == 0 or y.sum() == len(y):
        return {"n": int(len(y)), "positives": int(y.sum()), "note": "needs both classes"}
    pr, rc, f1, _ = precision_recall_fscore_support(y, p >= thr, average="binary", zero_division=0)
    return {"n": int(len(y)), "positives": int(y.sum()), "base_rate": round(float(y.mean()), 4),
            "pr_auc": round(float(average_precision_score(y, p)), 4), "roc_auc": round(float(roc_auc_score(y, p)), 4),
            "precision": round(float(pr), 4), "recall": round(float(rc), 4), "f1": round(float(f1), 4), "threshold": round(float(thr), 4)}


def best_threshold(y, p):
    """Threshold with best F1 on TRAINING-side scores (never picked on the test data)."""
    ts = np.unique(np.quantile(p, np.linspace(0.5, 0.999, 120)))
    f = [precision_recall_fscore_support(y, p >= t, average="binary", zero_division=0)[2] for t in ts]
    return float(ts[int(np.argmax(f))])


def models():
    return {
        "random_forest": lambda: RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED),
        "gradient_boosting": lambda: HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=250, class_weight="balanced", random_state=SEED),
    }


def baseline_score(df):                       # larger = more suspicious: a bigger NDVI drop
    return (-df["d_ndvi"]).to_numpy()


def evaluate(df, name, make):
    X, y = df[FEATURES].to_numpy(), df["lost_in_year"].to_numpy().astype(int)
    rand = (df["stratum"] == "random").to_numpy()
    out = {}
    # ---- 1. spatial CV: whole cells held out
    oof = np.full(len(df), np.nan)
    gkf = GroupKFold(n_splits=5)
    for tr, te in gkf.split(X, y, groups=df["cell"]):
        m = make().fit(X[tr], y[tr])
        oof[te] = m.predict_proba(X[te])[:, 1]
    thr = best_threshold(y[~np.isnan(oof)], oof[~np.isnan(oof)])
    out["spatial_cv_random_sample"] = metrics(y[rand], oof[rand], thr)
    # ---- 2. temporal holdout: last year is the test set
    last = df["year"].max()
    tr, te = (df["year"] < last).to_numpy(), (df["year"] == last).to_numpy()
    if tr.sum() and te.sum():
        m = make().fit(X[tr], y[tr])
        p_tr = m.predict_proba(X[tr])[:, 1]
        thr_t = best_threshold(y[tr], p_tr)
        p_te = m.predict_proba(X[te])[:, 1]
        out[f"temporal_holdout_{int(last)}_random_sample"] = metrics(y[te & rand], m.predict_proba(X[te & rand])[:, 1], thr_t)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(HERE / "data" / "terrapulse_training_points.csv"))
    ap.add_argument("--save", action="store_true", help="fit on all data and write the joblib")
    ap.add_argument("--synthetic-smoke-test", action="store_true", help="CODE CHECK ONLY: random fake data, results are meaningless")
    a = ap.parse_args()
    path = Path(a.csv)
    df = load(path)
    y = df["lost_in_year"].astype(int)
    print(f"positives: {int(y.sum())} of {len(df)} ({y.mean():.2%}); random-sample positives: {int(y[df.stratum=='random'].sum())}")
    if y.sum() < 30:
        print("WARNING: fewer than 30 positive examples - the model cannot be trusted. Widen the area/years or raise N_LOSS.")

    report = {"label": "Hansen tree-cover loss in year Y (any cause, satellite-derived, not field-verified)",
              "features": FEATURES, "rows": int(len(df)), "positives": int(y.sum()),
              "years": sorted(map(int, df["year"].unique())), "smoke_test_only": bool(a.synthetic_smoke_test)}
    rand = (df["stratum"] == "random").to_numpy()
    s = baseline_score(df)
    report["baseline_ndvi_drop_rule"] = metrics(y.to_numpy()[rand], (s[rand] - s.min()) / (np.ptp(s) + 1e-9), best_threshold(y.to_numpy(), (s - s.min()) / (np.ptp(s) + 1e-9)))
    report["models"] = {}
    for name, make in models().items():
        print("evaluating", name)
        report["models"][name] = evaluate(df, name, make)

    # ---- importance (random forest, permutation, spatially held out)
    X, yy = df[FEATURES].to_numpy(), y.to_numpy()
    te_cells = df["cell"].isin(df["cell"].drop_duplicates().sample(frac=0.25, random_state=SEED))
    m = models()["random_forest"]().fit(X[~te_cells], yy[~te_cells])
    if yy[te_cells].sum() > 0:
        pi = permutation_importance(m, X[te_cells], yy[te_cells], scoring="average_precision", n_repeats=8, random_state=SEED)
        imp = pd.DataFrame({"feature": FEATURES, "permutation_importance": pi.importances_mean, "std": pi.importances_std}).sort_values("permutation_importance", ascending=False)
    else:
        imp = pd.DataFrame({"feature": FEATURES, "permutation_importance": m.feature_importances_}).sort_values("permutation_importance", ascending=False)
    (HERE / "out").mkdir(exist_ok=True)
    imp.to_csv(HERE / "out" / "feature_importance.csv", index=False)
    report["top_features"] = imp.head(5)["feature"].tolist()

    (HERE / "out" / "metrics.json").write_text(json.dumps(report, indent=2))
    write_card(report)
    if a.save and not a.synthetic_smoke_test:
        import joblib
        best = max(report["models"], key=lambda k: report["models"][k]["spatial_cv_random_sample"].get("pr_auc", 0))
        final = models()[best]().fit(X, yy)
        joblib.dump({"model": final, "features": FEATURES, "name": best, "label": report["label"]}, HERE / "out" / "TerraPulse_Loss_Model.joblib")
        print("saved", best)
    print(json.dumps({k: report[k] for k in ("baseline_ndvi_drop_rule",)}, indent=1))
    for k, v in report["models"].items():
        print(k, json.dumps(v["spatial_cv_random_sample"]))


def write_card(r):
    lines = ["# TerraPulse vegetation-loss model - evaluation", ""]
    if r["smoke_test_only"]:
        lines += ["**SMOKE TEST ON FAKE DATA - THESE NUMBERS MEAN NOTHING.**", ""]
    lines += ["## What it predicts", f"- {r['label']}", "- It does not identify the cause and does not decide legality.", "",
              "## Data", f"- {r['rows']} point-year rows, {r['positives']} loss examples, years {r['years']}",
              f"- Features: {', '.join(r['features'])}", "",
              "## Results (random sample only = real base rate)",
              f"- Baseline rule (bigger NDVI drop = more suspicious): {json.dumps(r['baseline_ndvi_drop_rule'])}"]
    for k, v in r["models"].items():
        for split, m in v.items():
            lines.append(f"- {k} / {split}: {json.dumps(m)}")
    lines += ["", "## Read this honestly",
              "- If a model does not beat the baseline rule, say so in the review.",
              "- Labels are satellite-derived (Hansen), yearly, and cover loss from any cause.",
              "- Scores come from Mudumalai only; they do not transfer to other forests without re-testing.",
              "- Top features: " + ", ".join(r["top_features"])]
    (HERE / "out" / "model_card.md").write_text("\n".join(lines))


if __name__ == "__main__":
    main()
