"""
face_service.py
---------------
Flask backend for the Digital Token Appointment System.
- Accepts base64 face image from React frontend
- Extracts embedding via InsightFace
- Matches against patients.json
- Returns digital token on successful match

Run: python face_service.py
CORS enabled for http://localhost:5173 (Vite dev server)
"""

import os
import json
import base64
import uuid
import numpy as np
import cv2
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from insightface.app import FaceAnalysis

# ── Config ──────────────────────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "db/patients.json")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
SIMILARITY_THRESHOLD = 0.45   # cosine similarity — tune as needed
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── InsightFace init (loads once at startup) ─────────────────────────────────
print("🔧 Loading InsightFace model...")
face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("✅ InsightFace ready.")

# ── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app, origins=["http://localhost:5173"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_db():
    with open(DB_PATH, "r") as f:
        data = json.load(f)
        # Handle both formats: list or dict
        if isinstance(data, list):
            return {"patients": data}
        return data


def save_db(db: dict):
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def is_embedding_vector(value) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(item, (int, float)) for item in value)
    )


def patient_embedding_vectors(patient: dict) -> list[np.ndarray]:
    """
    Return all usable embeddings for a patient.

    Supports the old format:
      "face_embeddings": [0.1, 0.2, ...]

    And the new format:
      "face_embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]]
    """
    raw_embeddings = patient.get("face_embeddings")

    # Backward compatibility for older helper-script registrations.
    if raw_embeddings is None:
        raw_embeddings = patient.get("face_embedding")

    if not raw_embeddings:
        return []

    if is_embedding_vector(raw_embeddings):
        return [np.array(raw_embeddings, dtype=np.float32)]

    vectors = []
    if isinstance(raw_embeddings, list):
        for item in raw_embeddings:
            if is_embedding_vector(item):
                vectors.append(np.array(item, dtype=np.float32))
            elif isinstance(item, dict) and is_embedding_vector(item.get("vector")):
                vectors.append(np.array(item["vector"], dtype=np.float32))

    return vectors


def append_patient_embedding(patient: dict, embedding: np.ndarray) -> int:
    vectors = [vector.tolist() for vector in patient_embedding_vectors(patient)]
    vectors.append(embedding.tolist())
    patient["face_embeddings"] = vectors
    patient.pop("face_embedding", None)
    return len(vectors)


def decode_image(b64_string: str) -> np.ndarray:
    """Decode base64 image string (with or without data URI prefix) to OpenCV mat."""
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    img_bytes = base64.b64decode(b64_string)
    np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return img
def extract_embedding(img):
    """Return (embedding, error_message). embedding is None on failure."""

    if img is None:
        return None, "Could not decode image."

    faces = face_app.get(img)

    if not faces:
        return None, "No face detected. Please look directly at the camera."

    if len(faces) > 1:
        faces = sorted(
            faces,
            key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
            reverse=True,
        )

    return faces[0].normed_embedding, None


def find_best_match(embedding, patients):
    """Return (best_patient, best_score) or (None, 0)."""

    best_patient = None
    best_score = 0.0

    for patient in patients:
        for stored in patient_embedding_vectors(patient):
            if stored.shape != embedding.shape:
                continue

            score = cosine_similarity(embedding, stored)

            if score > best_score:
                best_score = score
                best_patient = patient

    return best_patient, best_score


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": datetime.utcnow().isoformat()})


@app.route("/patients", methods=["GET"])
def list_patients():
    db = load_db()
    # Handle both formats
    patients_list = db if isinstance(db, list) else db.get("patients", [])
    safe = [
        {k: v for k, v in p.items() if k != "face_embeddings"}  # Note: face_embeddings, not face_embedding
        for p in patients_list
    ]
    return jsonify({"patients": safe})


@app.route("/verify", methods=["POST"])
def verify_face():
    """
    POST /verify
    Body: { "image": "<base64 image string>" }
    Returns digital token if face matches a registered patient.
    """
    data = request.get_json(force=True)
    if not data or "image" not in data:
        return jsonify({"success": False, "error": "No image provided."}), 400

    # Decode & extract embedding
    img = decode_image(data["image"])
    embedding, err = extract_embedding(img)
    if err:
        return jsonify({"success": False, "error": err}), 422

    # Match against DB
    db = load_db()
    # Handle both formats: list [] or dict with "patients" key
    patients_list = db if isinstance(db, list) else db.get("patients", [])
    patient, score = find_best_match(embedding, patients_list)
    if patient is None or score < SIMILARITY_THRESHOLD:
        return jsonify({
            "success": False,
            "error": "Face not recognised. Please ensure you are registered or speak to reception.",
            "confidence": round(score * 100, 1),
        }), 404

    # Mark token as issued
    for p in db["patients"]:
        if p["patient_id"] == patient["patient_id"]:
            p["token_issued"] = True
            p["token_issued_at"] = datetime.utcnow().isoformat()
    save_db(db)

    appt_time = datetime.fromisoformat(patient["appointment_time"])

    return jsonify({
        "success": True,
        "confidence": round(score * 100, 1),
        "token": patient["digital_token"],
        "patient": {
            "name": patient["name"],
            "patient_id": patient["patient_id"],
            "appointment_id": patient["appointment_id"],
            "appointment_time": appt_time.strftime("%d %b %Y, %I:%M %p"),
            "doctor": patient["doctor"],
            "department": patient["department"],
        },
    })


@app.route("/register", methods=["POST"])
def register_face():
    """
    POST /register
    Body: { "patient_id": "PAT-001", "image": "<base64>" }
    Registers (or updates) a patient's face embedding.
    """
    data = request.get_json(force=True)
    patient_id = data.get("patient_id")
    b64_image = data.get("image")

    if not patient_id or not b64_image:
        return jsonify({"success": False, "error": "patient_id and image are required."}), 400

    db = load_db()
    patient = next((p for p in db["patients"] if p["patient_id"] == patient_id), None)
    if not patient:
        return jsonify({"success": False, "error": f"Patient {patient_id} not found."}), 404

    img = decode_image(b64_image)
    embedding, err = extract_embedding(img)
    if err:
        return jsonify({"success": False, "error": err}), 422

    for p in db["patients"]:
        if p["patient_id"] == patient_id:
            embedding_count = append_patient_embedding(p, embedding)
            p["registered"] = True
            p["registered_at"] = datetime.utcnow().isoformat()
    save_db(db)

    return jsonify({
        "success": True,
        "message": f"Face registered for {patient['name']}.",
        "embedding_count": embedding_count,
    })


@app.route("/book", methods=["POST"])
def book_appointment():
    """
    POST /book
    Body: { "name": str, "doctor": str, "department": str, "appointment_time": ISO str }
    Creates a new patient record with a generated digital token.
    Returns the patient_id to use when registering the face.
    """
    data = request.get_json(force=True)
    required = ["name", "doctor", "department", "appointment_time"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"success": False, "error": f"Missing fields: {missing}"}), 400

    db = load_db()
    patient_count = len(db["patients"]) + 1
    patient_id = f"PAT-{patient_count:03d}"
    appointment_id = f"APT-{datetime.utcnow().strftime('%Y')}-{patient_count:04d}"
    token = f"TKN-{uuid.uuid4().hex[:8].upper()}"

    new_patient = {
        "patient_id": patient_id,
        "name": data["name"],
        "appointment_id": appointment_id,
        "appointment_time": data["appointment_time"],
        "doctor": data["doctor"],
        "department": data["department"],
        "digital_token": token,
        "token_issued": False,
        "face_embeddings": [],
        "registered": False,
    }

    db["patients"].append(new_patient)
    save_db(db)

    return jsonify({
        "success": True,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "digital_token": token,
        "message": "Appointment booked. Please register your face to activate your digital token.",
    })


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting Face Token Service on http://localhost:5050")
    app.run(host="0.0.0.0", port=5050, debug=True)
