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
from datetime import UTC, datetime

import cv2
from insightface.app import FaceAnalysis


DB_PATH = os.path.join(os.path.dirname(__file__), "../db/patients.json")
REQUIRED_FACE_SAMPLE_COUNT = 3


def utc_timestamp() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def get_embedding_from_image(face_app: FaceAnalysis, image_path: str) -> list[float] | None:
    """Extract face embedding from an image file."""
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    faces = face_app.get(img)
    if not faces:
        print(f"❌ No face detected in image: {image_path}")
        return None

    if len(faces) > 1:
        print(f"⚠️  {len(faces)} faces detected in {image_path}. Using the largest one.")
        faces = sorted(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
            reverse=True,
        )

    return faces[0].normed_embedding.tolist()


def register_patient_face_set(patient_id: str, image_paths: list[str]) -> int:
    if len(image_paths) != REQUIRED_FACE_SAMPLE_COUNT:
        raise ValueError(f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} images are required.")

    with open(DB_PATH, "r") as f:
        db = json.load(f)

    patient = next((p for p in db["patients"] if p["patient_id"] == patient_id), None)
    if not patient:
        print(f"❌ Patient {patient_id} not found in database.")
        return 1

    face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    face_app.prepare(ctx_id=0, det_size=(640, 640))

    print(f"📸 Processing 3 face images for {patient['name']} ({patient_id})...")
    embeddings = []
    for index, image_path in enumerate(image_paths, start=1):
        embedding = get_embedding_from_image(face_app, image_path)
        if embedding is None:
            print("No changes written. All three images must be valid.")
            return 1
        embeddings.append(embedding)
        print(f"   Image {index}: usable")

    patient["face_embeddings"] = embeddings
    patient.pop("face_embedding", None)
    patient["registered"] = True
    patient["registered_at"] = utc_timestamp()

    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)

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
