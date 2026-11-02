"""
TerraPulse - retrospective check of the vegetation-change rule against Hansen loss (uses the CSV from 03_validate_rule_landsat.js).

THE RULE (transparent, fixed before looking at results)
  baseline  = mean seasonal NDVI (and NBR) of the 3 windows before the loss year L (at least 2 usable)
  change_k  = value in the after-window k  minus baseline          k = 0: window of year L,  k = 1: window of year L+1
  relative  = change_k minus the MEDIAN change of stable control pixels in the same year (removes drought / sensor offsets)
  FLAG      = relative NDVI change <= -T  AND  relative NBR change <= -T
  Primary T is fixed in advance (--primary-threshold). Other thresholds are a SENSITIVITY table only - do not pick the
  best one from it and then quote its hit rate; with so few loss pixels that would be tuning on the answer.

WHAT IS REPORTED
  hit rate on Hansen loss pixels, false-flag rate on stable controls, both with Wilson 95% intervals; pixels without enough
  clear Landsat views are "not testable" and are never counted as hits or misses; the base-rate effect (how many false flags
  the same rule would raise across the whole park each year); and a fire split (flag with / without MODIS fire nearby).

WHAT IT DOES NOT SHOW
  Hansen loss is yearly, satellite-derived, from any cause, and not field-verified. A flag means POTENTIAL forest-cover change
  for an officer to check. It says nothing about legality.
"""
import argparse, json, math, sys
from pathlib import Path
import numpy as np, pandas as pd

HERE = Path(__file__).parent
TAGS = ["m3", "m2", "m1", "z", "p1"]
SENSITIVITY = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30]


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))


def fmt(k, n):
    p, lo, hi = wilson(k, n)
    return {"k": int(k), "n": int(n), "rate": None if n == 0 else round(p, 4), "ci95": None if n == 0 else [round(lo, 4), round(hi, 4)]}


def prepare(df, min_obs):
    need = ["role", "eval_year", "fire_days_year_L", "fire_days_Lp1_window"] + [f"{b}_{t}" for t in TAGS for b in ("ndvi", "nbr", "n")]
    miss = [c for c in need if c not in df.columns]
    if miss:
        sys.exit(f"CSV is missing columns: {miss}")
    for t in TAGS:
        df[f"n_{t}"] = df[f"n_{t}"].fillna(0)
    ok = {t: (df[f"n_{t}"] >= min_obs) & df[f"ndvi_{t}"].notna() & df[f"nbr_{t}"].notna() for t in TAGS}
    base_ok = ok["m3"].astype(int) + ok["m2"].astype(int) + ok["m1"].astype(int)
    df["baseline_ok"] = base_ok >= 2
    for b in ("ndvi", "nbr"):
        cols = [df[f"{b}_{t}"].where(ok[t]) for t in ("m3", "m2", "m1")]
        df[f"base_{b}"] = pd.concat(cols, axis=1).mean(axis=1, skipna=True)
        for k, t in ((0, "z"), (1, "p1")):
            df[f"d_{b}_{k}"] = df[f"{b}_{t}"].where(ok[t]) - df[f"base_{b}"]
    df["valid_0"] = df["baseline_ok"] & ok["z"]
    df["valid_1"] = df["baseline_ok"] & ok["p1"]
    df["testable"] = df["valid_0"] | df["valid_1"]
    # regional reference = median change of STABLE CONTROL pixels in the same year
    ctrl = df[(df["role"] == "control")]
    ref_rows = []
    for y, g in ctrl.groupby("eval_year"):
        r = {"eval_year": int(y)}
        for k in (0, 1):
            v = g[g[f"valid_{k}"]]
            r[f"n_ref_{k}"] = int(len(v))
            for b in ("ndvi", "nbr"):
                r[f"ref_{b}_{k}"] = float(v[f"d_{b}_{k}"].median()) if len(v) else np.nan
        ref_rows.append(r)
    ref = pd.DataFrame(ref_rows)
    df = df.merge(ref, on="eval_year", how="left")
    for k in (0, 1):
        for b in ("ndvi", "nbr"):
            df[f"rel_{b}_{k}"] = df[f"d_{b}_{k}"] - df[f"ref_{b}_{k}"]
    df["fire_near"] = (df["fire_days_year_L"].fillna(0) > 0) | (df["fire_days_Lp1_window"].fillna(0) > 0)
    return df, ref


def flags(df, T):
    f0 = df["valid_0"] & (df["rel_ndvi_0"] <= -T) & (df["rel_nbr_0"] <= -T)
    f1 = df["valid_1"] & (df["rel_ndvi_1"] <= -T) & (df["rel_nbr_1"] <= -T)
    return f0, f1, (f0 | f1)


def summarise(df, T, forest_pixels):
    f0, f1, fa = flags(df, T)
    loss, ctrl = df["role"] == "loss", df["role"] == "control"
    out = {"threshold": T}
    for name, f, valid in (("window_of_loss_year", f0, df["valid_0"]), ("window_after_loss_year", f1, df["valid_1"]), ("either_window", fa, df["testable"])):
        out[name] = {"hit_rate_on_loss_pixels": fmt((f & loss & valid).sum(), (loss & valid).sum()),
                     "false_flag_rate_on_controls": fmt((f & ctrl & valid).sum(), (ctrl & valid).sum())}
    # base-rate effect, using the "either window" rates
    hit = out["either_window"]["hit_rate_on_loss_pixels"]["rate"]
    ffr = out["either_window"]["false_flag_rate_on_controls"]["rate"]
    yrs = sorted(df[loss]["eval_year"].dropna().unique())
    if hit is not None and ffr is not None and yrs and forest_pixels:
        per_year_loss = loss.sum() / len(yrs)
        tp = hit * per_year_loss
        fp = ffr * (forest_pixels - per_year_loss)
        out["base_rate_effect_if_run_over_the_whole_park"] = {
            "forest_pixels": forest_pixels, "avg_true_loss_pixels_per_validation_year": round(per_year_loss, 2),
            "expected_correct_flags_per_year": round(tp, 2), "expected_false_flags_per_year": round(fp, 1),
            "false_flag_area_ha_per_year": round(fp * 0.09, 1), "implied_precision_pixel_level": round(tp / (tp + fp), 5) if (tp + fp) > 0 else None}
    # fire split of flagged pixels
    split = {}
    for role, mask in (("loss", loss), ("control", ctrl)):
        flagged = fa & mask & df["testable"]
        split[role] = {"flagged": int(flagged.sum()), "flagged_with_fire_nearby": int((flagged & df["fire_near"]).sum()),
                       "flagged_without_fire_nearby": int((flagged & ~df["fire_near"]).sum())}
    out["fire_split_of_flagged_pixels"] = split
    return out


def by_year(df, T):
    f0, f1, fa = flags(df, T)
    rows = []
    for y, g in df[df["role"] == "loss"].groupby("eval_year"):
        idx = g.index
        rows.append({"loss_year": int(y), "loss_pixels": int(len(g)), "testable": int(g["testable"].sum()),
                     "hit_window_of_loss_year": int(f0[idx].sum()), "hit_window_after": int(f1[idx].sum()), "hit_either": int(fa[idx].sum()),
                     "with_fire_nearby": int(g["fire_near"].sum())})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(HERE / "data" / "terrapulse_rule_validation_points.csv"))
    ap.add_argument("--min-obs", type=int, default=2, help="minimum clear Landsat observations per window")
    ap.add_argument("--primary-threshold", type=float, default=0.15, help="fixed in advance; do not tune on these results")
    ap.add_argument("--forest-pixels", type=int, default=193653, help="forest pixels in the study area (from your Console print)")
    ap.add_argument("--synthetic-smoke-test", action="store_true")
    a = ap.parse_args()
    df = pd.read_csv(a.csv)
    df, ref = prepare(df, a.min_obs)
    n_loss, n_ctrl = int((df.role == "loss").sum()), int((df.role == "control").sum())
    print(f"rows: {len(df)} | loss-pixel rows: {n_loss} | control rows: {n_ctrl} | testable loss rows: {int(((df.role=='loss') & df.testable).sum())}")
    primary = summarise(df, a.primary_threshold, a.forest_pixels)
    sens = [summarise(df, T, a.forest_pixels) for T in SENSITIVITY]
    years = by_year(df, a.primary_threshold)
    report = {"smoke_test_only": bool(a.synthetic_smoke_test), "min_obs": a.min_obs, "primary_threshold": a.primary_threshold,
              "rows": {"loss": n_loss, "control": n_ctrl,
                       "loss_not_testable": int(((df.role == "loss") & ~df.testable).sum()),
                       "control_not_testable": int(((df.role == "control") & ~df.testable).sum())},
              "regional_reference_by_year": ref.round(4).to_dict("records"), "primary": primary, "loss_by_year": years,
              "sensitivity_either_window": [{"threshold": s["threshold"], **{k: s["either_window"][k] for k in s["either_window"]}} for s in sens]}
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    (out / "rule_validation_report.json").write_text(json.dumps(report, indent=2))
    write_md(report, out / "rule_validation_report.md")
    print(json.dumps({"primary": primary, "loss_by_year": years}, indent=1))


def pct(m):
    return "n/a" if m["rate"] is None else f"{100*m['rate']:.3g}% ({m['k']}/{m['n']}, 95% CI {100*m['ci95'][0]:.3g}-{100*m['ci95'][1]:.3g}%)"


def write_md(r, path):
    p = r["primary"]
    L = ["# Vegetation-change rule - retrospective check against Hansen loss (Landsat)", ""]
    if r["smoke_test_only"]:
        L += ["**SMOKE TEST ON FAKE DATA - NOTHING BELOW IS A RESULT.**", ""]
    L += ["## What was tested",
          "- Rule: relative NDVI AND NBR drop of at least T versus the same seasonal window of the 3 earlier years, "
          f"relative to the median change of stable forest. T = {r['primary_threshold']} was fixed in advance.",
          "- It flags POTENTIAL forest-cover change for officer verification. It does not identify cause or legality.",
          "- Reference: Hansen tree-cover loss (yearly, satellite-derived, any cause, not field-verified).", "",
          "## Data", f"- loss-pixel rows: {r['rows']['loss']} (not testable: {r['rows']['loss_not_testable']}); "
          f"control rows: {r['rows']['control']} (not testable: {r['rows']['control_not_testable']})",
          "- Not testable = too few clear Landsat views; never counted as hit or miss.", "",
          f"## Results at the fixed threshold T = {r['primary_threshold']}"]
    for name in ("window_of_loss_year", "window_after_loss_year", "either_window"):
        L.append(f"- {name}: hit rate on loss pixels {pct(p[name]['hit_rate_on_loss_pixels'])}; false-flag rate on stable controls {pct(p[name]['false_flag_rate_on_controls'])}")
    b = p.get("base_rate_effect_if_run_over_the_whole_park")
    if b:
        L += ["", "## Base-rate effect (why pixel-level flags alone are not enough)",
              f"- Over {b['forest_pixels']} forest pixels with about {b['avg_true_loss_pixels_per_validation_year']} true loss pixels per year, "
              f"the rule would give about {b['expected_correct_flags_per_year']} correct and {b['expected_false_flags_per_year']} false flags per year "
              f"(about {b['false_flag_area_ha_per_year']} ha of false flags). Implied pixel-level precision: {b['implied_precision_pixel_level']}.",
              "- Flags should therefore be grouped into patches and ranked by size, persistence and fire context before an officer sees them."]
    fs = p["fire_split_of_flagged_pixels"]
    L += ["", "## Fire context of flagged pixels (MODIS, 1 km, coarse)",
          f"- loss pixels flagged: {fs['loss']['flagged']} (with fire nearby {fs['loss']['flagged_with_fire_nearby']}, without {fs['loss']['flagged_without_fire_nearby']})",
          f"- controls flagged: {fs['control']['flagged']} (with fire nearby {fs['control']['flagged_with_fire_nearby']}, without {fs['control']['flagged_without_fire_nearby']})",
          "", "## By loss year", "| loss year | loss pixels | testable | hit (year L window) | hit (year L+1 window) | hit (either) | fire nearby |", "|---|---|---|---|---|---|---|"]
    for y in r["loss_by_year"]:
        L.append(f"| {y['loss_year']} | {y['loss_pixels']} | {y['testable']} | {y['hit_window_of_loss_year']} | {y['hit_window_after']} | {y['hit_either']} | {y['with_fire_nearby']} |")
    L += ["", "## Sensitivity (for transparency only - do not pick the best row and quote it)"]
    for s in r["sensitivity_either_window"]:
        L.append(f"- T = {s['threshold']}: hit {pct(s['hit_rate_on_loss_pixels'])}; false flags {pct(s['false_flag_rate_on_controls'])}")
    L += ["", "## Limits to state in the review",
          "- Only a few dozen loss pixels, probably from a handful of events: intervals are wide and precision cannot be estimated well.",
          "- Hansen gives the year, not the month; both the same-year and next-year windows are shown.",
          "- Landsat 7 scan-line gaps and sensor differences add noise; MODIS fire is 1 km.",
          "- Selective felling and small clearings may not appear in a 30 m Landsat composite or in Hansen at all."]
    path.write_text("\n".join(L))


if __name__ == "__main__":
    main()
