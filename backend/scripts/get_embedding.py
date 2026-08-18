"""
get_embedding.py
----------------
Register exactly three face embeddings for an existing patient.

Usage:
  python scripts/get_embedding.py --patient_id PAT-001 \
    --images forward.jpg left.jpg right.jpg

Requirements: insightface, onnxruntime, opencv-python, numpy
"""

import argparse
import json
import os
import tempfile
from datetime import UTC, datetime

import cv2
import numpy as np
from insightface.app import FaceAnalysis


BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH_VALUE = os.path.expanduser(os.getenv(
    "DB_PATH",
    os.path.join(BACKEND_DIR, "db", "patients.json"),
))
DB_PATH = DB_PATH_VALUE if os.path.isabs(DB_PATH_VALUE) else os.path.join(BACKEND_DIR, DB_PATH_VALUE)
REQUIRED_FACE_SAMPLE_COUNT = 3
ANGLE_TARGETS = (("forward", -8, 8), ("left", -30, -15), ("right", 15, 30))
REGISTRATION_SIMILARITY_THRESHOLD = float(os.getenv("REGISTRATION_SIMILARITY_THRESHOLD", "0.20"))


def utc_timestamp() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def get_embedding_from_image(
    face_app: FaceAnalysis,
    image_path: str,
    target: tuple[str, float, float],
) -> list[float] | None:
    """Extract face embedding from an image file."""
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    faces = face_app.get(img)
    if not faces:
        print(f"❌ No face detected in image: {image_path}")
        return None

    if len(faces) > 1:
        print(f"❌ {len(faces)} faces detected in {image_path}. Exactly one is required.")
        return None

    label, yaw_min, yaw_max = target
    pose = getattr(faces[0], "pose", None)
    if pose is None or len(pose) < 3:
        print(f"❌ Face pose is unavailable in image: {image_path}")
        return None
    pitch, yaw, roll = float(pose[0]), float(pose[1]), float(pose[2])
    if not yaw_min <= yaw <= yaw_max or abs(pitch) > 18 or abs(roll) > 12:
        print(
            f"❌ {label} pose is out of range in {image_path} "
            f"(pitch={pitch:.1f}, yaw={yaw:.1f}, roll={roll:.1f})."
        )
        return None

    return faces[0].normed_embedding.tolist()


def register_patient_face_set(patient_id: str, image_paths: list[str]) -> int:
    if len(image_paths) != REQUIRED_FACE_SAMPLE_COUNT:
        raise ValueError(f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} images are required.")

    with open(DB_PATH, "r", encoding="utf-8") as f:
        db = json.load(f)
    if not isinstance(db, dict) or not isinstance(db.get("patients"), list):
        raise ValueError("patients.json must contain a 'patients' list.")

    patient = next((p for p in db["patients"] if p["patient_id"] == patient_id), None)
    if not patient:
        print(f"❌ Patient {patient_id} not found in database.")
        return 1

    face_app = FaceAnalysis(
        name=os.getenv("FACE_MODEL", "buffalo_l"),
        root=os.path.expanduser(os.getenv("INSIGHTFACE_HOME", "~/.insightface")),
        providers=["CPUExecutionProvider"],
    )
    face_app.prepare(ctx_id=0, det_size=(640, 640))

    print(f"📸 Processing 3 face images for {patient['name']} ({patient_id})...")
    embeddings = []
    for index, (image_path, target) in enumerate(zip(image_paths, ANGLE_TARGETS), start=1):
        embedding = get_embedding_from_image(face_app, image_path, target)
        if embedding is None:
            print("No changes written. All three images must be valid.")
            return 1
        embeddings.append(embedding)
        print(f"   Image {index}: usable")

    vectors = [np.asarray(embedding, dtype=np.float32) for embedding in embeddings]
    pair_scores = [
        float(np.dot(vectors[first], vectors[second]))
        for first, second in ((0, 1), (0, 2), (1, 2))
    ]
    if min(pair_scores) < REGISTRATION_SIMILARITY_THRESHOLD:
        print("❌ The three images do not appear to show the same person.")
        print(f"   Pair similarities: {', '.join(f'{score:.3f}' for score in pair_scores)}")
        print("No changes written.")
        return 1

    patient["face_embeddings"] = embeddings
    patient.pop("face_embedding", None)
    patient["registered"] = True
    patient["registered_at"] = utc_timestamp()

    db_directory = os.path.dirname(DB_PATH)
    fd, temporary_path = tempfile.mkstemp(prefix=".medipass-", suffix=".json", dir=db_directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(db, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary_path, DB_PATH)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise

    print(f"✅ Three face embeddings registered for {patient['name']}")
    print(f"   Stored face samples: {len(embeddings)}")
    print(f"   Appointment: {patient['appointment_id']}")
    print(f"   Token ready: {patient['digital_token']}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Register exactly three patient face embeddings")
    parser.add_argument("--patient_id", required=True, help="Patient ID (e.g. PAT-001)")
    parser.add_argument(
        "--images",
        nargs=REQUIRED_FACE_SAMPLE_COUNT,
        required=True,
        metavar=("FORWARD", "LEFT", "RIGHT"),
        help="Exactly three patient photos: forward, left, and right",
    )
    args = parser.parse_args()

    raise SystemExit(register_patient_face_set(args.patient_id, args.images))
