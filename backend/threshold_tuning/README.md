# Threshold Tuning

Standalone tooling for choosing a face-match threshold from the selected VGGFace2 test data.

This does not change the running app. It only reads images, computes scores, and writes a report. You can delete this folder later without affecting the backend.

## What It Measures

For each person in `backend/demo_seed/faces`:

- Uses `forward.jpg`, `left.jpg`, and `right.jpg` as the registered face samples.
- Builds the same seven check-in comparison vectors used by `/verify`:
  - `forward`
  - `left`
  - `right`
  - `forward_left_average`
  - `forward_right_average`
  - `left_right_average`
  - `all_angles_average`
- Uses images in `remaining/` as check-in test images.

For every remaining image, the tool records:

- `genuine_score`: best score against the correct person.
- `impostor_score`: best score against every other person.
- `top_match_correct`: whether the highest score overall belongs to the correct person.

Then it evaluates thresholds and reports false accept / false reject tradeoffs.

## Run

From `backend`:

```bash
source venv/bin/activate
python threshold_tuning/tune_threshold.py
```

Full analysis can take a while because it may process tens of thousands of images. Embeddings are cached in `backend/threshold_tuning/output/embedding_cache.npz`, so later runs are much faster.

## Faster Test Run

```bash
python threshold_tuning/tune_threshold.py --max-people 10 --max-probes-per-person 20
```

## Outputs

Written to `backend/threshold_tuning/output/`:

- `threshold_report.json`: summary, recommended threshold, score percentiles.
- `threshold_metrics.csv`: FAR/FRR metrics for each tested threshold.
- `score_samples.csv`: per-image genuine/impostor scores for debugging.

## Recommendation Logic

By default, the recommended threshold is the lowest threshold where hardest-impostor false accept rate is at or below `0.1%`.

Change that target:

```bash
python threshold_tuning/tune_threshold.py --target-far 0.005
```

That means a target false accept rate of `0.5%`.
