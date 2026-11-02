# TerraPulse model training

1. Run `01_export_training_data.js` in the Earth Engine Code Editor (instructions at the top of the file). Download the CSV into `data/terrapulse_training_points.csv`.
2. From `backend` with the venv active: `python ../training/02_train.py` (add `--save` to write `out/TerraPulse_Loss_Model.joblib`).
3. Read `out/model_card.md`. If the model does not beat the baseline rule, say so.

`make_fake_csv_for_smoke_test.py` only checks that the code runs. Its output is random and must never be quoted.

## Rule validation (Landsat) - primary disturbance flag
The primary flag for potential forest-cover change is a transparent temporal vegetation-change rule. Hansen loss is used only as a
retrospective reference. The Random Forest stays a preliminary multi-feature disturbance-probability model; neither is a
deforestation-legality classifier.

1. Run `03_validate_rule_landsat.js` in the Earth Engine Code Editor and press RUN on its single export. Put the CSV in `data/`
   as `terrapulse_rule_validation_points.csv`.
2. Run `python ../training/04_evaluate_rule.py` (from `backend`, venv active). Read `out/rule_validation_report.md`.
3. `make_fake_validation_csv_for_smoke_test.py` only checks that the code runs. Never quote its output.
