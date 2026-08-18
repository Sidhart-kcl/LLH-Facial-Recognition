"""
Tune the face-match threshold from the selected VGGFace2 demo data.

This is intentionally separate from the Flask app. It reads:

backend/demo_seed/faces/Person_Name/
  forward.jpg
  left.jpg
  right.jpg
  remaining/

It uses forward/left/right as the enrolled samples and remaining/ as check-in
probes, then measures genuine scores and hardest-impostor scores.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
DEFAULT_FACES_DIR = BACKEND_DIR / "demo_seed" / "faces"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parent / "output"
SELECTED_STEMS = ("forward", "left", "right")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
CACHE_VERSION = 2  # Increment when face-selection or embedding rules change.
REGISTRATION_SIMILARITY_THRESHOLD = float(os.getenv("REGISTRATION_SIMILARITY_THRESHOLD", "0.20"))


@dataclass(frozen=True)
class Identity:
    index: int
    name: str
    folder: Path
    registration_paths: list[Path]
    probe_paths: list[Path]


@dataclass(frozen=True)
class ProbeScore:
    person: str
    image_path: str
    genuine_score: float
    impostor_score: float
    top_score: float
    top_person: str
    top_match_label: str
    top_match_correct: bool


def image_files_in(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def display_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(PROJECT_DIR))
    except ValueError:
        return str(path)


def cache_key_for(image_path: Path) -> str:
    return display_path(image_path)


def discover_identities(
    faces_dir: Path,
    *,
    max_people: int | None,
    max_probes_per_person: int | None,
) -> list[Identity]:
    identities: list[Identity] = []

    for folder in sorted(path for path in faces_dir.iterdir() if path.is_dir()) if faces_dir.exists() else []:
        top_level = {path.stem.lower(): path for path in image_files_in(folder)}
        registration_paths = [
            top_level[stem]
            for stem in SELECTED_STEMS
            if stem in top_level
        ]
        if len(registration_paths) != len(SELECTED_STEMS):
            continue

        probes = image_files_in(folder / "remaining")
        if max_probes_per_person is not None:
            probes = probes[:max_probes_per_person]

        identities.append(Identity(
            index=len(identities),
            name=folder.name,
            folder=folder,
            registration_paths=registration_paths,
            probe_paths=probes,
        ))

        if max_people is not None and len(identities) >= max_people:
            break

    return identities


def normalize(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector.astype(np.float32)
    return (vector / norm).astype(np.float32)


def averaged(vectors: list[np.ndarray]) -> np.ndarray:
    return normalize(np.mean(vectors, axis=0))


def match_vectors(registration_embeddings: list[np.ndarray]) -> list[tuple[str, np.ndarray]]:
    forward, left, right = [normalize(vector) for vector in registration_embeddings[:3]]
    return [
        ("forward", forward),
        ("left", left),
        ("right", right),
        ("forward_left_average", averaged([forward, left])),
        ("forward_right_average", averaged([forward, right])),
        ("left_right_average", averaged([left, right])),
        ("all_angles_average", averaged([forward, left, right])),
    ]


def load_cache(cache_path: Path) -> dict[str, dict[str, Any]]:
    if not cache_path.exists():
        return {}

    with np.load(cache_path, allow_pickle=False) as data:
        if "version" not in data or int(data["version"][0]) != CACHE_VERSION:
            return {}
        paths = data["paths"].copy()
        mtimes = data["mtimes"].copy()
        sizes = data["sizes"].copy()
        embeddings = data["embeddings"].copy()

    cache: dict[str, dict[str, Any]] = {}
    for index, raw_path in enumerate(paths):
        cache[str(raw_path)] = {
            "mtime_ns": int(mtimes[index]),
            "size": int(sizes[index]),
            "embedding": embeddings[index].astype(np.float32),
        }
    return cache


def save_cache(cache_path: Path, cache: dict[str, dict[str, Any]]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    paths = np.array(list(cache.keys()))
    mtimes = np.array([item["mtime_ns"] for item in cache.values()], dtype=np.int64)
    sizes = np.array([item["size"] for item in cache.values()], dtype=np.int64)
    embeddings = np.stack([item["embedding"] for item in cache.values()]).astype(np.float32)
    np.savez_compressed(
        cache_path,
        paths=paths,
        mtimes=mtimes,
        sizes=sizes,
        embeddings=embeddings,
        version=np.array([CACHE_VERSION], dtype=np.int64),
    )


def load_face_model():
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(
        name=os.getenv("FACE_MODEL", "buffalo_l"),
        root=os.path.expanduser(os.getenv("INSIGHTFACE_HOME", "~/.insightface")),
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=0, det_size=(640, 640))
    return app


def extract_embedding(face_app, image_path: Path) -> np.ndarray | None:
    import cv2

    image = cv2.imread(str(image_path))
    if image is None:
        return None

    faces = face_app.get(image)
    if not faces:
        return None

    if len(faces) > 1:
        return None

    return normalize(faces[0].normed_embedding.astype(np.float32))


def cached_embedding(
    *,
    image_path: Path,
    face_app,
    cache: dict[str, dict[str, Any]],
) -> np.ndarray | None:
    stat = image_path.stat()
    key = cache_key_for(image_path)
    cached = cache.get(key)

    if (
        cached
        and cached["mtime_ns"] == stat.st_mtime_ns
        and cached["size"] == stat.st_size
    ):
        return cached["embedding"]

    embedding = extract_embedding(face_app, image_path)
    if embedding is None:
        return None

    cache[key] = {
        "mtime_ns": stat.st_mtime_ns,
        "size": stat.st_size,
        "embedding": embedding,
    }
    return embedding


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    return round(float(np.percentile(np.array(values, dtype=np.float32), q)), 6)


def evaluate_thresholds(
    scores: list[ProbeScore],
    *,
    start: float,
    end: float,
    step: float,
) -> list[dict[str, Any]]:
    metrics = []
    threshold = start

    while threshold <= end + 1e-9:
        genuine_accepts = [
            score for score in scores
            if score.genuine_score >= threshold
        ]
        false_rejects = len(scores) - len(genuine_accepts)
        hardest_false_accepts = [
            score for score in scores
            if score.impostor_score >= threshold
        ]
        wrong_top_accepts = [
            score for score in scores
            if score.top_score >= threshold and not score.top_match_correct
        ]
        correct_top_accepts = [
            score for score in scores
            if score.top_score >= threshold and score.top_match_correct
        ]

        total = len(scores)
        metrics.append({
            "threshold": round(threshold, 6),
            "genuine_accept_rate": len(genuine_accepts) / total,
            "false_reject_rate": false_rejects / total,
            "hardest_impostor_false_accept_rate": len(hardest_false_accepts) / total,
            "wrong_identity_accept_rate": len(wrong_top_accepts) / total,
            "correct_top_accept_rate": len(correct_top_accepts) / total,
            "false_reject_count": false_rejects,
            "hardest_impostor_false_accept_count": len(hardest_false_accepts),
            "wrong_identity_accept_count": len(wrong_top_accepts),
            "correct_top_accept_count": len(correct_top_accepts),
        })
        threshold += step

    return metrics


def choose_recommendations(
    metrics: list[dict[str, Any]],
    *,
    target_far: float,
) -> dict[str, Any]:
    if not metrics:
        return {}

    eligible = [
        row for row in metrics
        if row["hardest_impostor_false_accept_rate"] <= target_far
    ]
    recommended = min(
        eligible,
        key=lambda row: (row["false_reject_rate"], row["threshold"]),
    ) if eligible else max(metrics, key=lambda row: row["threshold"])

    eer = min(
        metrics,
        key=lambda row: abs(
            row["false_reject_rate"] - row["hardest_impostor_false_accept_rate"]
        ),
    )

    return {
        "target_far": target_far,
        "recommended_threshold": recommended,
        "eer_like_threshold": eer,
    }


def write_metrics_csv(path: Path, metrics: list[dict[str, Any]]) -> None:
    if not metrics:
        return

    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(metrics[0].keys()))
        writer.writeheader()
        writer.writerows(metrics)


def write_scores_csv(path: Path, scores: list[ProbeScore]) -> None:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "person",
            "image_path",
            "genuine_score",
            "impostor_score",
            "top_score",
            "top_person",
            "top_match_label",
            "top_match_correct",
        ])
        writer.writeheader()
        for score in scores:
            writer.writerow({
                "person": score.person,
                "image_path": score.image_path,
                "genuine_score": round(score.genuine_score, 6),
                "impostor_score": round(score.impostor_score, 6),
                "top_score": round(score.top_score, 6),
                "top_person": score.top_person,
                "top_match_label": score.top_match_label,
                "top_match_correct": score.top_match_correct,
            })


def run(args: argparse.Namespace) -> None:
    faces_dir = args.faces_dir.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    identities = discover_identities(
        faces_dir,
        max_people=args.max_people,
        max_probes_per_person=args.max_probes_per_person,
    )

    print(f"Faces directory: {faces_dir}")
    print(f"Detected identities: {len(identities)}")
    print(f"Probe images: {sum(len(identity.probe_paths) for identity in identities)}")

    if args.dry_run:
        for identity in identities:
            print(f"{identity.name}: {len(identity.registration_paths)} registration, {len(identity.probe_paths)} probes")
        return

    if not identities:
        raise SystemExit("No identities found.")

    cache_path = output_dir / "embedding_cache.npz"
    cache = load_cache(cache_path)
    face_app = load_face_model()

    candidate_vectors: list[np.ndarray] = []
    candidate_people: list[str] = []
    candidate_identity_indexes: list[int] = []
    candidate_labels: list[str] = []
    usable_identities: list[Identity] = []

    for identity in identities:
        registration_embeddings = [
            cached_embedding(image_path=path, face_app=face_app, cache=cache)
            for path in identity.registration_paths
        ]
        if any(embedding is None for embedding in registration_embeddings):
            print(f"Skipping {identity.name}: one or more registration images had no face.")
            continue

        normalized_registration = [
            normalize(embedding)
            for embedding in registration_embeddings
            if embedding is not None
        ]
        pair_scores = [
            float(np.dot(normalized_registration[first], normalized_registration[second]))
            for first, second in ((0, 1), (0, 2), (1, 2))
        ]
        if min(pair_scores) < REGISTRATION_SIMILARITY_THRESHOLD:
            print(f"Skipping {identity.name}: registration face set is inconsistent.")
            continue

        usable_identities.append(identity)
        for label, vector in match_vectors(normalized_registration):
            candidate_vectors.append(vector)
            candidate_people.append(identity.name)
            candidate_identity_indexes.append(identity.index)
            candidate_labels.append(label)

    if not candidate_vectors:
        raise SystemExit("No usable registration vectors found.")

    candidate_matrix = np.stack(candidate_vectors).astype(np.float32)
    candidate_identity_indexes_arr = np.array(candidate_identity_indexes)
    scores: list[ProbeScore] = []
    skipped_probes = 0

    for identity in usable_identities:
        own_mask = candidate_identity_indexes_arr == identity.index
        other_mask = ~own_mask

        for probe_path in identity.probe_paths:
            probe_embedding = cached_embedding(
                image_path=probe_path,
                face_app=face_app,
                cache=cache,
            )
            if probe_embedding is None:
                skipped_probes += 1
                continue

            similarities = candidate_matrix @ probe_embedding
            own_indexes = np.flatnonzero(own_mask)
            other_indexes = np.flatnonzero(other_mask)
            if own_indexes.size == 0 or other_indexes.size == 0:
                continue

            own_best_index = int(own_indexes[np.argmax(similarities[own_indexes])])
            other_best_index = int(other_indexes[np.argmax(similarities[other_indexes])])
            top_index = int(np.argmax(similarities))

            scores.append(ProbeScore(
                person=identity.name,
                image_path=str(probe_path.relative_to(faces_dir)),
                genuine_score=float(similarities[own_best_index]),
                impostor_score=float(similarities[other_best_index]),
                top_score=float(similarities[top_index]),
                top_person=candidate_people[top_index],
                top_match_label=candidate_labels[top_index],
                top_match_correct=candidate_people[top_index] == identity.name,
            ))

        print(f"Scored {identity.name}: {len(scores)} total probes so far")

    save_cache(cache_path, cache)

    if not scores:
        raise SystemExit("No usable probe images found.")

    metrics = evaluate_thresholds(
        scores,
        start=args.threshold_start,
        end=args.threshold_end,
        step=args.threshold_step,
    )
    recommendations = choose_recommendations(metrics, target_far=args.target_far)

    genuine_scores = [score.genuine_score for score in scores]
    impostor_scores = [score.impostor_score for score in scores]
    top_wrong = [score for score in scores if not score.top_match_correct]

    report = {
        "faces_dir": display_path(faces_dir),
        "identity_count": len(usable_identities),
        "probe_count": len(scores),
        "skipped_probe_count": skipped_probes,
        "candidate_vectors_per_identity": 7,
        "recommendations": recommendations,
        "score_percentiles": {
            "genuine": {
                "min": percentile(genuine_scores, 0),
                "p01": percentile(genuine_scores, 1),
                "p05": percentile(genuine_scores, 5),
                "p10": percentile(genuine_scores, 10),
                "median": percentile(genuine_scores, 50),
                "p90": percentile(genuine_scores, 90),
                "max": percentile(genuine_scores, 100),
            },
            "hardest_impostor": {
                "min": percentile(impostor_scores, 0),
                "p90": percentile(impostor_scores, 90),
                "p95": percentile(impostor_scores, 95),
                "p99": percentile(impostor_scores, 99),
                "p999": percentile(impostor_scores, 99.9),
                "max": percentile(impostor_scores, 100),
            },
        },
        "wrong_top_match_count": len(top_wrong),
        "wrong_top_match_rate": len(top_wrong) / len(scores),
    }

    report_path = output_dir / "threshold_report.json"
    metrics_path = output_dir / "threshold_metrics.csv"
    scores_path = output_dir / "score_samples.csv"

    report_path.write_text(json.dumps(report, indent=2))
    write_metrics_csv(metrics_path, metrics)
    write_scores_csv(scores_path, scores)

    recommended = recommendations.get("recommended_threshold", {})
    print("\nDone.")
    print(f"Usable identities: {len(usable_identities)}")
    print(f"Usable probes: {len(scores)}")
    print(f"Skipped probes: {skipped_probes}")
    if recommended:
        print(f"Recommended threshold: {recommended['threshold']}")
        print(f"False reject rate at recommendation: {recommended['false_reject_rate']:.4%}")
        print(
            "Hardest-impostor false accept rate at recommendation: "
            f"{recommended['hardest_impostor_false_accept_rate']:.4%}"
        )
    print(f"Report: {report_path}")
    print(f"Metrics: {metrics_path}")
    print(f"Scores: {scores_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tune MediPass face-match threshold.")
    parser.add_argument("--faces-dir", type=Path, default=DEFAULT_FACES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--max-people", type=int, default=None)
    parser.add_argument("--max-probes-per-person", type=int, default=None)
    parser.add_argument("--target-far", type=float, default=0.001)
    parser.add_argument("--threshold-start", type=float, default=0.20)
    parser.add_argument("--threshold-end", type=float, default=0.80)
    parser.add_argument("--threshold-step", type=float, default=0.005)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.max_people is not None and args.max_people <= 0:
        parser.error("--max-people must be positive.")
    if args.max_probes_per_person is not None and args.max_probes_per_person <= 0:
        parser.error("--max-probes-per-person must be positive.")
    if not 0 <= args.target_far <= 1:
        parser.error("--target-far must be between 0 and 1.")
    if args.threshold_step <= 0:
        parser.error("--threshold-step must be positive.")
    if args.threshold_start >= args.threshold_end:
        parser.error("--threshold-start must be lower than --threshold-end.")
    if not 0 <= args.threshold_start <= 1 or not 0 <= args.threshold_end <= 1:
        parser.error("Threshold bounds must be between 0 and 1.")

    return args


if __name__ == "__main__":
    run(parse_args())
