"""
TerraPulse - train and evaluate a tree-cover-loss RISK model (matches 01_export_training_data.js).

Input : data/terrapulse_training_points.csv
Output: out/metrics.json, out/model_card.md, out/feature_importance.csv,
        out/TerraPulse_Loss_Model.joblib   (only with --save)

What is predicted
    Satellite-derived tree-cover loss (Hansen lossyear) in target year y, from data dated BEFORE y.
    It is not a fire classifier, not field-verified, and says nothing about legality or cause.

Splits (all come from the 'role' column written by the export script)
    train                  train blocks, years before the test year   -> the ONLY rows the models see
    test_spatial           eval blocks,  years before the test year   -> unseen places
    test_temporal          train blocks, test year                    -> unseen year
    test_spatial_temporal  eval blocks,  test year                    -> unseen places AND year
    Test rows keep the real loss prevalence. Thresholds are chosen on out-of-fold TRAIN predictions
    (blocks held out) and never on test rows.

Not used as inputs: year, window years, lon/lat, block ids, qa_* columns, lossyear_raw.
Baseline: a plain "bigger NDVI drop = more suspicious" rule, scored on the same test rows.
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
FEATURES = ["d_ndvi", "d_nbr", "ndvi_prev", "nbr_prev", "d_vv", "d_vh",
            "rain_anom_12m", "temp_anom_12m", "fire_days_12m", "elevation", "slope"]
TEST_ROLES = ["test_spatial", "test_temporal", "test_spatial_temporal"]
SEED = 42
MIN_TEST_POSITIVES = 10


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    need = set(FEATURES + ["role", "year", "lon", "lat", "block_id", "lost_in_year", "lost_before", "sample_source"])
    miss = need - set(df.columns)
    if miss:
        sys.exit(f"CSV is missing columns: {sorted(miss)} - re-run the corrected 01_export_training_data.js")
    for c in ("lost_in_year", "lost_before"):
        df[c] = df[c].astype(str).str.lower().isin(["1", "1.0", "true"])
    n0 = len(df)
    df = df[~df["lost_before"]].dropna(subset=FEATURES)           # safety net; the export already filters these
    print(f"rows: {n0} -> {len(df)} after dropping previous-loss rows and rows with missing features")
    return df


def metrics(y, p, thr):
    y = np.asarray(y).astype(int)
    out = {"n": int(len(y)), "positives": int(y.sum()), "base_rate": round(float(y.mean()), 5) if len(y) else None}
    if y.sum() == 0 or y.sum() == len(y):
        out["note"] = "needs both classes - no scores"
        return out
    pr, rc, f1, _ = precision_recall_fscore_support(y, p >= thr, average="binary", zero_division=0)
    out.update(pr_auc=round(float(average_precision_score(y, p)), 4), roc_auc=round(float(roc_auc_score(y, p)), 4),
               precision=round(float(pr), 4), recall=round(float(rc), 4), f1=round(float(f1), 4), threshold=round(float(thr), 5))
    if y.sum() < MIN_TEST_POSITIVES:
        out["warning"] = f"only {int(y.sum())} positives - treat as anecdotal"
    return out


def best_threshold(y, p):
    ts = np.unique(np.quantile(p, np.linspace(0.5, 0.999, 150)))
    f = [precision_recall_fscore_support(y, p >= t, average="binary", zero_division=0)[2] for t in ts]
    return float(ts[int(np.argmax(f))])


def scale01(s, ref):
    lo, hi = ref.min(), ref.max()
    return (s - lo) / (hi - lo + 1e-12)


def model_makers():
    return {
        "random_forest": lambda: RandomForestClassifier(n_estimators=300, min_samples_leaf=5, class_weight="balanced_subsample", n_jobs=-1, random_state=SEED),
        "gradient_boosting": lambda: HistGradientBoostingClassifier(max_depth=4, learning_rate=0.06, max_iter=250, class_weight="balanced", random_state=SEED),
    }


def describe_split(df):
    """Which years and which places each role uses - printed and stored in the report."""
    d = {}
    for role, g in df.groupby("role"):
        d[role] = {"rows": int(len(g)), "positives": int(g["lost_in_year"].sum()), "years": sorted(map(int, g["year"].unique())),
                   "blocks": int(g["block_id"].nunique()), "lon_range": [round(float(g.lon.min()), 4), round(float(g.lon.max()), 4)],
                   "lat_range": [round(float(g.lat.min()), 4), round(float(g.lat.max()), 4)]}
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(HERE / "data" / "terrapulse_training_points.csv"))
    ap.add_argument("--save", action="store_true", help="write the joblib of the best model (fit on train rows only)")
    ap.add_argument("--synthetic-smoke-test", action="store_true", help="CODE CHECK ONLY: random fake data, results are meaningless")
    a = ap.parse_args()
    df = load(Path(a.csv))
    tr = df[df["role"] == "train"].reset_index(drop=True)
    if tr.empty or tr["lost_in_year"].sum() < 2:
        sys.exit("Not enough training positives. See the WARNING lines from the export script.")
    print(f"train rows {len(tr)}, positives {int(tr.lost_in_year.sum())} ({tr.lost_in_year.mean():.2%}); sources: {tr.sample_source.value_counts().to_dict()}")
    if tr["lost_in_year"].sum() < 60:
        print("WARNING: fewer than 60 training positives - the model cannot be trusted.")
    split = describe_split(df)
    print("SPLIT:", json.dumps(split, indent=1))

    Xtr, ytr = tr[FEATURES].to_numpy(), tr["lost_in_year"].to_numpy().astype(int)
    report = {"label": "Hansen tree-cover loss in calendar year y (any cause; satellite-derived; not field-verified; not legality)",
              "inputs_use_only_data_before_year": True, "features": FEATURES, "split": split,
              "train_prevalence": round(float(ytr.mean()), 5), "smoke_test_only": bool(a.synthetic_smoke_test), "models": {}}

    # ---- baseline: bigger NDVI drop = higher score; threshold picked on train rows
    s_tr = -tr["d_ndvi"].to_numpy()
    base_thr = best_threshold(ytr, scale01(s_tr, s_tr))
    report["baseline_ndvi_drop_rule"] = {}
    for role in TEST_ROLES:
        te = df[df["role"] == role]
        if len(te):
            report["baseline_ndvi_drop_rule"][role] = metrics(te["lost_in_year"], scale01(-te["d_ndvi"].to_numpy(), s_tr), base_thr)

    # ---- models: block-held-out out-of-fold train predictions choose the threshold; test rows are scored once
    groups = tr["block_id"]
    n_splits = min(5, groups.nunique())
    fitted = {}
    for name, make in model_makers().items():
        print("training", name)
        oof = np.zeros(len(tr))
        for i_tr, i_te in GroupKFold(n_splits=n_splits).split(Xtr, ytr, groups):
            oof[i_te] = make().fit(Xtr[i_tr], ytr[i_tr]).predict_proba(Xtr[i_te])[:, 1]
        thr = best_threshold(ytr, oof)
        m = make().fit(Xtr, ytr)
        fitted[name] = (m, thr)
        res = {"train_blockwise_cv": metrics(ytr, oof, thr)}
        for role in TEST_ROLES:
            te = df[df["role"] == role]
            if len(te):
                res[role] = metrics(te["lost_in_year"], m.predict_proba(te[FEATURES].to_numpy())[:, 1], thr)
        report["models"][name] = res

    # ---- importance on the pooled test rows (permutation, average precision)
    te_all = df[df["role"].isin(TEST_ROLES)]
    best = max(report["models"], key=lambda k: report["models"][k]["train_blockwise_cv"].get("pr_auc", 0))
    m, thr = fitted[best]
    if te_all["lost_in_year"].sum() > 0:
        pi = permutation_importance(m, te_all[FEATURES].to_numpy(), te_all["lost_in_year"].to_numpy().astype(int), scoring="average_precision", n_repeats=8, random_state=SEED)
        imp = pd.DataFrame({"feature": FEATURES, "permutation_importance": pi.importances_mean, "std": pi.importances_std}).sort_values("permutation_importance", ascending=False)
    else:
        imp = pd.DataFrame({"feature": FEATURES, "permutation_importance": np.nan})
    (HERE / "out").mkdir(exist_ok=True)
    imp.to_csv(HERE / "out" / "feature_importance.csv", index=False)
    report["best_model_by_train_cv_pr_auc"] = best
    report["top_features"] = imp.head(5)["feature"].tolist()
    (HERE / "out" / "metrics.json").write_text(json.dumps(report, indent=2))
    write_card(report)
    if a.save and not a.synthetic_smoke_test:
        import joblib
        joblib.dump({"model": m, "threshold": thr, "features": FEATURES, "name": best, "label": report["label"], "fit_on": "role == train only"}, HERE / "out" / "TerraPulse_Loss_Model.joblib")
        print("saved", best)
    print("\nBASELINE:", json.dumps(report["baseline_ndvi_drop_rule"], indent=1))
    for k, v in report["models"].items():
        print(k, json.dumps(v, indent=1))


def write_card(r):
    L = ["# TerraPulse tree-cover-loss risk model - evaluation", ""]
    if r["smoke_test_only"]:
        L += ["**SMOKE TEST ON FAKE DATA - THESE NUMBERS MEAN NOTHING.**", ""]
    L += ["## What it predicts", f"- {r['label']}",
          "- Inputs are dated before the target year only; no raw year or date is a feature.",
          "- It does not identify the cause and does not decide legality.", "",
          "## Which years and places are used", "| role | rows | positives | years | blocks | lon range | lat range |", "|---|---|---|---|---|---|---|"]
    for role, s in r["split"].items():
        L.append(f"| {role} | {s['rows']} | {s['positives']} | {s['years']} | {s['blocks']} | {s['lon_range']} | {s['lat_range']} |")
    L += ["", f"Training prevalence: {r['train_prevalence']}. Test roles keep the real prevalence.", "", "## Results",
          "Baseline (bigger NDVI drop = more suspicious):"]
    for role, m in r["baseline_ndvi_drop_rule"].items():
        L.append(f"- {role}: {json.dumps(m)}")
    for k, v in r["models"].items():
        L.append(f"\n{k}:")
        for split, m in v.items():
            L.append(f"- {split}: {json.dumps(m)}")
    L += ["", "## Read this honestly",
          "- If a model does not beat the NDVI-drop baseline on the test roles, say so.",
          "- Labels are yearly, satellite-derived (Hansen), cover loss from any cause, and are not field-verified.",
          "- Block gaps reduce but do not remove spatial autocorrelation between train and test places.",
          "- Scores apply to Mudumalai only. Top features: " + ", ".join(r["top_features"])]
    (HERE / "out" / "model_card.md").write_text("\n".join(L))


if __name__ == "__main__":
    main()
