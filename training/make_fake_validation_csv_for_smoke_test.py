"""Writes a FAKE csv in the validation export format so 04_evaluate_rule.py can be code-checked. Never quote its output."""
import numpy as np, pandas as pd, sys
rng = np.random.default_rng(1)
years = [2006, 2007, 2008, 2009, 2011, 2012, 2013, 2014, 2017, 2023]
tags, offs = ["m3", "m2", "m1", "z", "p1"], [-3, -2, -1, 0, 1]
rows = []
def make(role, y, pid):
    r = dict(pkey=pid, role=role, eval_year=y, lon=76.5, lat=11.6, lossyear_raw=(y - 2000 if role == "loss" else 0))
    yr_off = rng.normal(0, .03)
    base = rng.normal(.62, .05)
    for t, o in zip(tags, offs):
        v = base + rng.normal(0, .03) + (yr_off if o >= 0 else 0)
        drop = (-.3 if role == "loss" and rng.random() < .7 and o >= (0 if rng.random() < .5 else 1) else 0)
        r[f"ndvi_{t}"] = v + drop
        r[f"nbr_{t}"] = v * .8 + drop * .9 + rng.normal(0, .03)
        r[f"n_{t}"] = int(rng.integers(0, 6))
    r["fire_days_year_L"] = int(rng.integers(0, 2)); r["fire_days_Lp1_window"] = 0
    return r
for y in years:
    for i in range(1500): rows.append(make("control", y, f"c{i}"))
    for i in range(int(rng.integers(1, 20))): rows.append(make("loss", y, f"l{y}_{i}"))
pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
