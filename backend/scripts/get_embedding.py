"""
get_embedding.py
----------------
Run this script to register a patient's face embedding from a photo.
Usage: python get_embedding.py --patient_id PAT-001 --image path/to/photo.jpg

Requirements: insightface, onnxruntime, opencv-python, numpy
"""

import argparse
import json
import os
import numpy as np
import cv2
from insightface.app import FaceAnalysis

DB_PATH = os.path.join(os.path.dirname(__file__), "../db/patients.json")


def get_embedding_from_image(image_path: str) -> np.ndarray | None:
    """Extract face embedding from an image file."""
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))

    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Could not load image: {image_path}")

    faces = app.get(img)
    if not faces:
        print("❌ No face detected in the image.")
        return None

    if len(faces) > 1:
        print(f"⚠️  {len(faces)} faces detected. Using the largest one.")
        faces = sorted(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)

    embedding = faces[0].normed_embedding
    return embedding


def register_patient(patient_id: str, image_path: str):
    with open(DB_PATH, "r") as f:
        db = json.load(f)

    patient = next((p for p in db["patients"] if p["patient_id"] == patient_id), None)
    if not patient:
        print(f"❌ Patient {patient_id} not found in database.")
        return

    print(f"📸 Processing image for {patient['name']} ({patient_id})...")
    embedding = get_embedding_from_image(image_path)

    if embedding is None:
        return

    patient["face_embedding"] = embedding.tolist()
    patient["registered"] = True

    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)

    print(f"✅ Face embedding registered for {patient['name']}")
    print(f"   Appointment: {patient['appointment_id']}")
    print(f"   Token ready: {patient['digital_token']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Register patient face embedding")
    parser.add_argument("--patient_id", required=True, help="Patient ID (e.g. PAT-001)")
    parser.add_argument("--image", required=True, help="Path to patient photo")
    args = parser.parse_args()

    register_patient(args.patient_id, args.image)
