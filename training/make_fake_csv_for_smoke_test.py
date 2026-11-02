"""Writes a FAKE csv in the new export format so 02_train.py can be code-checked. Never use its output for results."""
import numpy as np, pandas as pd, sys
rng = np.random.default_rng(0)
rows = []
for pid in range(2500):
    lon, lat = rng.uniform(76.35, 76.65), rng.uniform(11.5, 11.75)
    block = f"{int(lon // .04)}_{int(lat // .04)}"
    h = abs(np.sin(int(lon // .04) * 12.9898 + int(lat // .04) * 78.233) * 43758.5453) % 1
    spatial = "eval" if h < .25 else "train"
    for y in (2021, 2022, 2023):
        lost = rng.random() < 0.03
        d = rng.normal(-0.2 if lost else 0, 0.12)
        role = ("test_spatial_temporal" if spatial == "eval" else "test_temporal") if y == 2023 else ("test_spatial" if spatial == "eval" else "train")
        rows.append(dict(point_id=pid, sample_source="uniform_random", block_id=block, spatial_split=spatial, role=role, year=y,
                         window_recent=y - 1, window_older=y - 2, lon=lon, lat=lat, lost_in_year=int(lost), lost_before=0,
                         d_ndvi=d, d_nbr=d + rng.normal(0, .05), ndvi_prev=rng.normal(.6, .1), nbr_prev=rng.normal(.4, .1),
                         d_vv=rng.normal(0, 1), d_vh=rng.normal(0, 1), rain_anom_12m=rng.normal(0, 200), temp_anom_12m=rng.normal(0, .5),
                         fire_days_12m=int(rng.integers(0, 3)), elevation=rng.normal(1000, 100), slope=rng.uniform(0, 20)))
pd.DataFrame(rows).to_csv(sys.argv[1], index=False)
