# TerraPulse model training

1. Run `01_export_training_data.js` in the Earth Engine Code Editor (instructions at the top of the file). Download the CSV into `data/terrapulse_training_points.csv`.
2. From `backend` with the venv active: `python ../training/02_train.py` (add `--save` to write `out/TerraPulse_Loss_Model.joblib`).
3. Read `out/model_card.md`. If the model does not beat the baseline rule, say so.

`make_fake_csv_for_smoke_test.py` only checks that the code runs. Its output is random and must never be quoted.
