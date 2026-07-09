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
import binascii
import uuid
import numpy as np
import cv2
from datetime import UTC, datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from insightface.app import FaceAnalysis

# ── Config ──────────────────────────────────────────────────────────────────
DB_DIR = os.path.join(os.path.dirname(__file__), "db")
DB_PATH = os.path.join(DB_DIR, "patients.json")
CHECKIN_ATTEMPTS_PATH = os.path.join(DB_DIR, "checkin_attempts.json")
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.45"))
ANGLE_SAMPLE_LABELS = ("forward", "left", "right")
REQUIRED_FACE_SAMPLE_COUNT = 3
POSE_YAW_SIGN = -1  # Flip to -1 if your camera/model reports left/right reversed.
POSE_TARGETS = {
    "forward": {"yaw": (-8, 8), "instruction": "Look straight at the camera."},
    "left": {"yaw": (-30, -25), "instruction": "Turn slightly left."},
    "right": {"yaw": (25, 30), "instruction": "Turn slightly right."},
}
POSE_MAX_ABS_PITCH = 14
POSE_MAX_ABS_ROLL = 12
POSE_MIN_FACE_AREA_RATIO = 0.08
POSE_MAX_CENTER_OFFSET = 0.18
POSE_MIN_DETECTION_SCORE = 0.65
POSE_MIN_BLUR_SCORE = 18.0
os.makedirs(DB_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── InsightFace init (loads once at startup) ─────────────────────────────────
print("🔧 Loading InsightFace model...")
face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("✅ InsightFace ready.")

# ── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
CORS(app, origins=cors_origins)


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_db():
    if not os.path.exists(DB_PATH):
        return {"patients": []}

    with open(DB_PATH, "r") as f:
        data = json.load(f)
        # Handle both formats: list or dict
        if isinstance(data, list):
            return {"patients": data}
        return data


def save_db(db: dict):
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)


def load_checkin_attempts():
    if not os.path.exists(CHECKIN_ATTEMPTS_PATH):
        return {"attempts": []}

    with open(CHECKIN_ATTEMPTS_PATH, "r") as f:
        data = json.load(f)
        if isinstance(data, list):
            return {"attempts": data}
        return data


def save_checkin_attempts(attempts_db: dict):
    with open(CHECKIN_ATTEMPTS_PATH, "w") as f:
        json.dump(attempts_db, f, indent=2)


def utc_timestamp() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def log_checkin_attempt(
    *,
    success: bool,
    reason: str,
    confidence: float | None = None,
    patient: dict | None = None,
    error: str | None = None,
):
    """Append one check-in attempt to a separate analytics log."""
    try:
        attempts_db = load_checkin_attempts()
        attempts = attempts_db.setdefault("attempts", [])

        attempt = {
            "attempt_id": f"ATT-{uuid.uuid4().hex[:10].upper()}",
            "timestamp": utc_timestamp(),
            "success": success,
            "reason": reason,
            "confidence": confidence,
            "threshold": SIMILARITY_THRESHOLD,
        }

        if patient:
            attempt.update({
                "patient_id": patient.get("patient_id"),
                "appointment_id": patient.get("appointment_id"),
                "doctor": patient.get("doctor"),
                "department": patient.get("department"),
            })

        if error:
            attempt["error"] = error

        attempts.append(attempt)
        save_checkin_attempts(attempts_db)
    except Exception as exc:
        print(f"⚠️  Failed to log check-in attempt: {exc}")


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-8))


def normalize_embedding(vector: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm


def averaged_embedding(vectors: list[np.ndarray]) -> np.ndarray:
    return normalize_embedding(np.mean(vectors, axis=0).astype(np.float32))


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


def patient_match_vectors(patient: dict) -> list[tuple[str, np.ndarray]]:
    """
    Build the candidate vectors used for check-in matching.

    For the VGGFace2 demo layout, each patient has three real angle samples:
    forward, left, and right. At check-in we compare against those three plus
    four derived averages, giving seven comparison vectors for that patient.
    """
    raw_vectors = [
        normalize_embedding(vector)
        for vector in patient_embedding_vectors(patient)
    ]

    if len(raw_vectors) != REQUIRED_FACE_SAMPLE_COUNT:
        return []

    forward, left, right = raw_vectors[:3]
    candidates = [
        (ANGLE_SAMPLE_LABELS[0], forward),
        (ANGLE_SAMPLE_LABELS[1], left),
        (ANGLE_SAMPLE_LABELS[2], right),
        ("forward_left_average", averaged_embedding([forward, left])),
        ("forward_right_average", averaged_embedding([forward, right])),
        ("left_right_average", averaged_embedding([left, right])),
        ("all_angles_average", averaged_embedding([forward, left, right])),
    ]

    return candidates


def set_patient_embeddings(patient: dict, embeddings: list[np.ndarray]) -> int:
    if len(embeddings) != REQUIRED_FACE_SAMPLE_COUNT:
        raise ValueError(f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} face samples are required.")

    patient["face_embeddings"] = [embedding.tolist() for embedding in embeddings]
    patient.pop("face_embedding", None)
    return len(patient["face_embeddings"])


def decode_image(b64_string: str) -> np.ndarray | None:
    """Decode base64 image string (with or without data URI prefix) to OpenCV mat."""
    if not isinstance(b64_string, str):
        return None
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(b64_string, validate=True)
    except (binascii.Error, ValueError):
        return None
    np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    return img


def face_area_ratio(face, img: np.ndarray) -> float:
    x1, y1, x2, y2 = face.bbox
    face_area = max(0.0, float(x2 - x1)) * max(0.0, float(y2 - y1))
    image_area = float(img.shape[0] * img.shape[1])
    return face_area / image_area if image_area else 0.0


def face_center_offset(face, img: np.ndarray) -> float:
    x1, y1, x2, y2 = face.bbox
    face_center_x = (float(x1) + float(x2)) / 2
    face_center_y = (float(y1) + float(y2)) / 2
    image_center_x = img.shape[1] / 2
    image_center_y = img.shape[0] / 2
    offset_x = abs(face_center_x - image_center_x) / img.shape[1]
    offset_y = abs(face_center_y - image_center_y) / img.shape[0]
    return max(offset_x, offset_y)


def blur_score(img: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def analyze_face_pose(img: np.ndarray, target: str) -> dict:
    if img is None:
        return {"ready": False, "message": "Could not decode image."}

    target_config = POSE_TARGETS.get(target)
    if not target_config:
        return {"ready": False, "message": f"Unknown target angle: {target}."}

    faces = face_app.get(img)
    if not faces:
        return {"ready": False, "message": "No face detected.", "target": target}
    if len(faces) > 1:
        return {"ready": False, "message": "Only one face should be visible.", "target": target}

    face = faces[0]
    raw_pose = getattr(face, "pose", None)
    if raw_pose is None or len(raw_pose) < 3:
        return {"ready": False, "message": "Face pose is unavailable.", "target": target}

    pitch = float(raw_pose[0])
    yaw = float(raw_pose[1]) * POSE_YAW_SIGN
    roll = float(raw_pose[2])
    yaw_min, yaw_max = target_config["yaw"]
    area_ratio = face_area_ratio(face, img)
    center_offset = face_center_offset(face, img)
    detection_score = float(getattr(face, "det_score", 0.0))
    sharpness = blur_score(img)

    checks = {
        "yaw_ok": yaw_min <= yaw <= yaw_max,
        "pitch_ok": abs(pitch) <= POSE_MAX_ABS_PITCH,
        "roll_ok": abs(roll) <= POSE_MAX_ABS_ROLL,
        "centered": center_offset <= POSE_MAX_CENTER_OFFSET,
        "large_enough": area_ratio >= POSE_MIN_FACE_AREA_RATIO,
        "detection_ok": detection_score >= POSE_MIN_DETECTION_SCORE,
        "sharp_enough": sharpness >= POSE_MIN_BLUR_SCORE,
    }
    ready = all(checks.values())

    if ready:
        message = "Hold still."
    elif not checks["yaw_ok"]:
        message = target_config["instruction"]
    elif not checks["centered"]:
        message = "Move your face to the center."
    elif not checks["large_enough"]:
        message = "Move closer to the camera."
    elif not checks["pitch_ok"]:
        message = "Keep your head level."
    elif not checks["roll_ok"]:
        message = "Do not tilt your head."
    elif not checks["sharp_enough"]:
        message = "Hold still for a sharper scan."
    else:
        message = "Improve lighting and hold still."

    return {
        "ready": ready,
        "target": target,
        "message": message,
        "pose": {
            "pitch": round(pitch, 2),
            "yaw": round(yaw, 2),
            "roll": round(roll, 2),
        },
        "quality": {
            "face_area_ratio": round(area_ratio, 4),
            "center_offset": round(center_offset, 4),
            "detection_score": round(detection_score, 4),
            "blur_score": round(sharpness, 2),
        },
        "checks": checks,
    }


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
    """Return (best_patient, best_score, match_label) or (None, 0, None)."""

    best_patient = None
    best_score = 0.0
    best_match_label = None

    for patient in patients:
        for match_label, stored in patient_match_vectors(patient):
            if stored.shape != embedding.shape:
                continue

            score = cosine_similarity(embedding, stored)

            if score > best_score:
                best_score = score
                best_patient = patient
                best_match_label = match_label

    return best_patient, best_score, best_match_label


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": utc_timestamp()})


@app.route("/patients", methods=["GET"])
def list_patients():
    db = load_db()
    # Handle both formats
    patients_list = db if isinstance(db, list) else db.get("patients", [])
    safe = []
    for patient in patients_list:
        safe_patient = {
            k: v
            for k, v in patient.items()
            if k not in ("face_embeddings", "face_embedding")
        }
        face_embedding_count = len(patient_embedding_vectors(patient))
        safe_patient["face_embedding_count"] = face_embedding_count
        safe_patient["registered"] = face_embedding_count == REQUIRED_FACE_SAMPLE_COUNT
        safe.append(safe_patient)
    return jsonify({"patients": safe})


@app.route("/checkin-attempts", methods=["GET"])
def list_checkin_attempts():
    attempts_db = load_checkin_attempts()
    return jsonify({"attempts": attempts_db.get("attempts", [])})


@app.route("/analyze-face-pose", methods=["POST"])
def analyze_face_pose_route():
    """
    POST /analyze-face-pose
    Body: { "image": "<base64 image string>", "target": "forward|left|right" }
    Returns pose/quality readiness for automatic registration capture.
    """
    data = request.get_json(force=True)
    if not data or "image" not in data:
        return jsonify({"ready": False, "error": "No image provided."}), 400

    target = data.get("target", "forward")
    img = decode_image(data["image"])
    analysis = analyze_face_pose(img, target)
    return jsonify(analysis)


@app.route("/verify", methods=["POST"])
def verify_face():
    """
    POST /verify
    Body: { "image": "<base64 image string>" }
    Returns digital token if face matches a registered patient.
    """
    data = request.get_json(force=True)
    if not data or "image" not in data:
        log_checkin_attempt(
            success=False,
            reason="missing_image",
            error="No image provided.",
        )
        return jsonify({"success": False, "error": "No image provided."}), 400

    # Decode & extract embedding
    img = decode_image(data["image"])
    embedding, err = extract_embedding(img)
    if err:
        reason = "no_face" if err.startswith("No face detected") else "invalid_image"
        log_checkin_attempt(
            success=False,
            reason=reason,
            error=err,
        )
        return jsonify({"success": False, "error": err}), 422

    # Match against DB
    db = load_db()
    # Handle both formats: list [] or dict with "patients" key
    patients_list = db if isinstance(db, list) else db.get("patients", [])
    patient, score, match_label = find_best_match(embedding, patients_list)
    confidence = round(score * 100, 1)
    if patient is None or score < SIMILARITY_THRESHOLD:
        log_checkin_attempt(
            success=False,
            reason="below_threshold" if patient else "no_registered_embeddings",
            confidence=confidence,
            patient=patient,
            error="Face not recognised. Please ensure you are registered or speak to reception.",
        )
        return jsonify({
            "success": False,
            "error": "Face not recognised. Please ensure you are registered or speak to reception.",
            "confidence": confidence,
        }), 404

    # Mark token as issued
    for p in db["patients"]:
        if p["patient_id"] == patient["patient_id"]:
            p["token_issued"] = True
            p["token_issued_at"] = utc_timestamp()
    save_db(db)

    appt_time = datetime.fromisoformat(patient["appointment_time"])
    log_checkin_attempt(
        success=True,
        reason="matched",
        confidence=confidence,
        patient=patient,
    )

    return jsonify({
        "success": True,
        "confidence": confidence,
        "match_label": match_label,
        "match_type": "derived_average" if match_label and "average" in match_label else "registered_sample",
        "token": patient["digital_token"],
        "patient": {
            "name": patient["name"],
            "patient_id": patient["patient_id"],
            "appointment_id": patient["appointment_id"],
            "appointment_time": appt_time.strftime("%d/%m/%Y, %H:%M"),
            "doctor": patient["doctor"],
            "department": patient["department"],
        },
    })


@app.route("/register", methods=["POST"])
def register_face():
    """
    POST /register
    Body: { "patient_id": "PAT-001", "image": "<base64>" }
    Disabled: single-image registration can create invalid sample counts.
    """
    return jsonify({
        "success": False,
        "error": "Single-image registration is disabled. Use /register-face-set with exactly 3 images.",
    }), 400


@app.route("/register-face-set", methods=["POST"])
def register_face_set():
    """
    POST /register-face-set
    Body: { "patient_id": "PAT-001", "images": ["<base64>", "<base64>", "<base64>"] }
    Replaces a patient's face embeddings with exactly three validated samples.
    """
    data = request.get_json(force=True)
    patient_id = data.get("patient_id")
    images = data.get("images")

    if not patient_id or not isinstance(images, list):
        return jsonify({"success": False, "error": "patient_id and images are required."}), 400

    if len(images) != REQUIRED_FACE_SAMPLE_COUNT:
        return jsonify({
            "success": False,
            "error": f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} face images are required.",
        }), 400

    db = load_db()
    patient = next((p for p in db["patients"] if p["patient_id"] == patient_id), None)
    if not patient:
        return jsonify({"success": False, "error": f"Patient {patient_id} not found."}), 404

    embeddings = []
    for index, b64_image in enumerate(images, start=1):
        img = decode_image(b64_image)
        embedding, err = extract_embedding(img)
        if err:
            return jsonify({
                "success": False,
                "error": f"Face image {index} failed: {err}",
                "failed_image_index": index,
            }), 422
        embeddings.append(embedding)

    for p in db["patients"]:
        if p["patient_id"] == patient_id:
            embedding_count = set_patient_embeddings(p, embeddings)
            p["registered"] = True
            p["registered_at"] = utc_timestamp()
    save_db(db)

    return jsonify({
        "success": True,
        "message": f"Three face scans registered for {patient['name']}.",
        "embedding_count": embedding_count,
    })


@app.route("/book", methods=["POST"])
def book_appointment():
    """
    POST /book
    Body: { "name": str, "doctor": str, "department": str, "appointment_time": ISO str }
    Disabled: standalone booking can create patients without exactly three face scans.
    """
    return jsonify({
        "success": False,
        "error": "Standalone booking is disabled. Use /book-with-face-set with exactly 3 face images.",
    }), 400


@app.route("/book-with-face-set", methods=["POST"])
def book_with_face_set():
    """
    POST /book-with-face-set
    Body: {
      "name": str,
      "doctor": str,
      "department": str,
      "appointment_time": ISO str,
      "images": ["<base64>", "<base64>", "<base64>"]
    }
    Creates a patient only after exactly three face embeddings are extracted.
    """
    data = request.get_json(force=True)
    required = ["name", "doctor", "department", "appointment_time"]
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({"success": False, "error": f"Missing fields: {missing}"}), 400

    images = data.get("images")
    if not isinstance(images, list) or len(images) != REQUIRED_FACE_SAMPLE_COUNT:
        return jsonify({
            "success": False,
            "error": f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} face images are required.",
        }), 400

    embeddings = []
    for index, b64_image in enumerate(images, start=1):
        img = decode_image(b64_image)
        embedding, err = extract_embedding(img)
        if err:
            return jsonify({
                "success": False,
                "error": f"Face image {index} failed: {err}",
                "failed_image_index": index,
            }), 422
        embeddings.append(embedding)

    db = load_db()
    patient_count = len(db["patients"]) + 1
    patient_id = f"PAT-{patient_count:03d}"
    appointment_id = f"APT-{datetime.now(UTC).strftime('%Y')}-{patient_count:04d}"
    token = f"TKN-{uuid.uuid4().hex[:8].upper()}"

    new_patient = {
        "patient_id": patient_id,
        "name": data["name"],
        "appointment_id": appointment_id,
        "appointment_time": data["appointment_time"],
        "doctor": data["doctor"],
        "department": data["department"],
        "digital_token": token,
        "created_at": utc_timestamp(),
        "token_issued": False,
        "face_embeddings": [embedding.tolist() for embedding in embeddings],
        "registered": True,
        "registered_at": utc_timestamp(),
    }

    db["patients"].append(new_patient)
    save_db(db)

    return jsonify({
        "success": True,
        "patient_id": patient_id,
        "appointment_id": appointment_id,
        "digital_token": token,
        "embedding_count": REQUIRED_FACE_SAMPLE_COUNT,
        "message": "Appointment booked with three registered face scans.",
    })


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting Face Token Service on http://localhost:5050")
    debug = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")
    app.run(host="0.0.0.0", port=5050, debug=debug)
