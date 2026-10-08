"""Writes a FAKE csv so 02_train.py can be code-checked. Never use its output for results."""
import numpy as np, pandas as pd, sys
rng = np.random.default_rng(0)
rows = []
for pid in range(1500):
    lon, lat = rng.uniform(76.35, 76.65), rng.uniform(11.5, 11.75)
    strat = "random" if pid < 1000 else "loss_oversample"
    for y in range(2019, 2024):
        lost = rng.random() < (0.02 if strat == "random" else 0.5)
        d = rng.normal(-0.25 if lost else 0, 0.12)
        rows.append(dict(point_id=pid, stratum=strat, year=y, lon=lon, lat=lat, lost_in_year=lost, lost_before=False, lossyear_raw=0,
                         d_ndvi=d, d_nbr=d + rng.normal(0, .05), ndvi_before=rng.normal(.6, .1), nbr_before=rng.normal(.4, .1),
                         d_vv=rng.normal(0, 1), d_vh=rng.normal(0, 1), rain_anom=rng.normal(0, 200), temp_change=rng.normal(0, .5),
                         fire_days=rng.integers(0, 3), elevation=rng.normal(1000, 100), slope=rng.uniform(0, 20), n_scenes_before=8, n_scenes_after=8))
pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
