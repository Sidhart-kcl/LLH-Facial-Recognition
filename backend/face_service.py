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
import re
import tempfile
import threading
import uuid
import numpy as np
import cv2
from datetime import UTC, datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from insightface.app import FaceAnalysis
from werkzeug.exceptions import HTTPException

# ── Config ──────────────────────────────────────────────────────────────────
BACKEND_DIR = os.path.dirname(__file__)


def configured_path(variable_name: str, default_path: str) -> str:
    value = os.path.expanduser(os.getenv(variable_name, default_path))
    return value if os.path.isabs(value) else os.path.abspath(os.path.join(BACKEND_DIR, value))


DB_PATH = configured_path("DB_PATH", os.path.join(BACKEND_DIR, "db", "patients.json"))
DB_DIR = os.path.dirname(DB_PATH)
CHECKIN_ATTEMPTS_PATH = configured_path(
    "CHECKIN_ATTEMPTS_PATH",
    os.path.join(DB_DIR, "checkin_attempts.json"),
)
UPLOAD_DIR = configured_path("UPLOAD_DIR", os.path.join(BACKEND_DIR, "uploads"))
FACE_MODEL = os.getenv("FACE_MODEL", "buffalo_l")
INSIGHTFACE_HOME = os.path.expanduser(os.getenv("INSIGHTFACE_HOME", "~/.insightface"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.45"))
REGISTRATION_SIMILARITY_THRESHOLD = float(os.getenv("REGISTRATION_SIMILARITY_THRESHOLD", "0.20"))
MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(20 * 1024 * 1024)))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(6 * 1024 * 1024)))
MAX_TEXT_LENGTH = 120
ANGLE_SAMPLE_LABELS = ("forward", "left", "right")
REQUIRED_FACE_SAMPLE_COUNT = 3
POSE_YAW_SIGN = int(os.getenv("POSE_YAW_SIGN", "-1"))
POSE_TARGETS = {
    "forward": {"yaw": (-8, 8), "instruction": "Look straight at the camera."},
    "left": {"yaw": (-30, -20), "instruction": "Turn slightly left."},
    "right": {"yaw": (20, 30), "instruction": "Turn slightly right."},
}
POSE_MAX_ABS_PITCH = 18
POSE_MAX_ABS_ROLL = 12
POSE_MIN_FACE_AREA_RATIO = 0.08
POSE_MAX_CENTER_OFFSET = 0.18
POSE_MIN_DETECTION_SCORE = 0.65
POSE_MIN_BLUR_SCORE = 18.0
os.makedirs(DB_DIR, exist_ok=True)
os.makedirs(os.path.dirname(CHECKIN_ATTEMPTS_PATH), exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

if not 0 <= SIMILARITY_THRESHOLD <= 1:
    raise ValueError("SIMILARITY_THRESHOLD must be between 0 and 1.")
if not -1 <= REGISTRATION_SIMILARITY_THRESHOLD <= 1:
    raise ValueError("REGISTRATION_SIMILARITY_THRESHOLD must be between -1 and 1.")
if MAX_REQUEST_BYTES <= 0 or MAX_IMAGE_BYTES <= 0:
    raise ValueError("Image and request size limits must be positive integers.")
if POSE_YAW_SIGN not in (-1, 1):
    raise ValueError("POSE_YAW_SIGN must be either -1 or 1.")

DB_LOCK = threading.RLock()
CHECKIN_ATTEMPTS_LOCK = threading.RLock()
MODEL_LOCK = threading.Lock()

# ── InsightFace init (loads once at startup) ─────────────────────────────────
print("🔧 Loading InsightFace model...")
face_app = FaceAnalysis(name=FACE_MODEL, root=INSIGHTFACE_HOME, providers=["CPUExecutionProvider"])
face_app.prepare(ctx_id=0, det_size=(640, 640))
print("✅ InsightFace ready.")

# ── Flask app ────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
CORS(app, origins=cors_origins)


# ── Helpers ──────────────────────────────────────────────────────────────────

def load_json_database(path: str, root_key: str) -> dict:
    """Load and validate one of the small local JSON databases."""
    if not os.path.exists(path):
        return {root_key: []}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        data = {root_key: data}
    if not isinstance(data, dict) or not isinstance(data.get(root_key), list):
        raise ValueError(f"{os.path.basename(path)} must contain a '{root_key}' list.")
    return data


def save_json_database(path: str, data: dict):
    """Atomically replace a JSON database so interrupted writes do not corrupt it."""
    fd, temporary_path = tempfile.mkstemp(
        prefix=".medipass-",
        suffix=".json",
        dir=os.path.dirname(path),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        raise


def load_db():
    if not os.path.exists(DB_PATH):
        return {"patients": []}
    return load_json_database(DB_PATH, "patients")


def save_db(db: dict):
    save_json_database(DB_PATH, db)


def load_checkin_attempts():
    return load_json_database(CHECKIN_ATTEMPTS_PATH, "attempts")


def save_checkin_attempts(attempts_db: dict):
    save_json_database(CHECKIN_ATTEMPTS_PATH, attempts_db)


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
        with CHECKIN_ATTEMPTS_LOCK:
            attempts_db = load_checkin_attempts()
            attempts = attempts_db["attempts"]
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


def json_body() -> tuple[dict | None, tuple | None]:
    """Return a JSON object or a consistent API error response."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, (jsonify({"success": False, "error": "A JSON object is required."}), 400)
    return data, None


def cleaned_text_fields(data: dict, field_names: list[str]) -> tuple[dict | None, str | None]:
    cleaned = {}
    for field_name in field_names:
        value = data.get(field_name)
        if not isinstance(value, str) or not value.strip():
            return None, f"{field_name} is required."
        value = value.strip()
        if len(value) > MAX_TEXT_LENGTH:
            return None, f"{field_name} must be {MAX_TEXT_LENGTH} characters or fewer."
        cleaned[field_name] = value
    return cleaned, None


def validate_appointment_time(value: str) -> str | None:
    pattern = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$"
    if not re.fullmatch(pattern, value):
        return "appointment_time must be an ISO 8601 date and time."
    try:
        appointment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return "appointment_time must be a valid date and time."
    now = datetime.now(appointment.tzinfo) if appointment.tzinfo else datetime.now()
    if appointment <= now:
        return "appointment_time must be in the future."
    return None


def validate_images(images) -> str | None:
    if not isinstance(images, list) or len(images) != REQUIRED_FACE_SAMPLE_COUNT:
        return f"Exactly {REQUIRED_FACE_SAMPLE_COUNT} face images are required."
    if not all(isinstance(image, str) and image.strip() for image in images):
        return "Every face image must be a non-empty base64 string."
    return None


def decode_image(b64_string: str) -> np.ndarray | None:
    """Decode base64 image string (with or without data URI prefix) to OpenCV mat."""
    if not isinstance(b64_string, str):
        return None
    if "," in b64_string:
        b64_string = b64_string.split(",", 1)[1]
    if len(b64_string) > ((MAX_IMAGE_BYTES + 2) // 3) * 4 + 4:
        return None
    try:
        img_bytes = base64.b64decode(b64_string, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not img_bytes or len(img_bytes) > MAX_IMAGE_BYTES:
        return None
    np_arr = np.frombuffer(img_bytes, dtype=np.uint8)
    try:
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except cv2.error:
        return None


def detect_faces(img: np.ndarray) -> list:
    with MODEL_LOCK:
        return face_app.get(img)


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


def analyze_face_pose(img: np.ndarray, target: str, faces: list | None = None) -> dict:
    if img is None:
        return {"ready": False, "message": "Could not decode image."}

    target_config = POSE_TARGETS.get(target)
    if not target_config:
        return {"ready": False, "message": f"Unknown target angle: {target}."}

    faces = detect_faces(img) if faces is None else faces
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

    faces = detect_faces(img)

    if not faces:
        return None, "No face detected. Please look directly at the camera."

    if len(faces) > 1:
        return None, "Multiple faces detected. Only one face should be visible."

    embedding = np.asarray(faces[0].normed_embedding, dtype=np.float32)
    if embedding.ndim != 1 or not embedding.size or not np.all(np.isfinite(embedding)):
        return None, "Could not extract a valid face embedding."
    return embedding, None


def extract_validated_face_set(images: list[str]) -> tuple[list[np.ndarray] | None, dict | None]:
    """Validate forward/left/right quality and return one embedding per image."""
    embeddings = []
    for index, (target, b64_image) in enumerate(zip(ANGLE_SAMPLE_LABELS, images), start=1):
        img = decode_image(b64_image)
        if img is None:
            return None, {
                "error": f"Face image {index} failed: Could not decode image.",
                "failed_image_index": index,
            }

        faces = detect_faces(img)
        analysis = analyze_face_pose(img, target, faces)
        if not analysis.get("ready"):
            return None, {
                "error": f"Face image {index} ({target}) failed: {analysis['message']}",
                "failed_image_index": index,
                "target": target,
                "analysis": analysis,
            }

        embedding = np.asarray(faces[0].normed_embedding, dtype=np.float32)
        if embedding.ndim != 1 or not embedding.size or not np.all(np.isfinite(embedding)):
            return None, {
                "error": f"Face image {index} failed: Could not extract a valid face embedding.",
                "failed_image_index": index,
            }
        embeddings.append(embedding)

    pair_scores = [
        cosine_similarity(embeddings[first], embeddings[second])
        for first, second in ((0, 1), (0, 2), (1, 2))
    ]
    if min(pair_scores) < REGISTRATION_SIMILARITY_THRESHOLD:
        return None, {
            "error": "The three face images do not appear to show the same person.",
            "pair_confidences": [round(score * 100, 1) for score in pair_scores],
        }

    return embeddings, None


def next_patient_number(patients: list[dict]) -> int:
    numbers = []
    for patient in patients:
        match = re.fullmatch(r"PAT-(\d+)", str(patient.get("patient_id", "")))
        if match:
            numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def booking_response(patient: dict) -> dict:
    return {
        "success": True,
        "patient_id": patient["patient_id"],
        "appointment_id": patient["appointment_id"],
        "digital_token": patient["digital_token"],
        "embedding_count": len(patient_embedding_vectors(patient)),
        "message": "Appointment booked with three registered face scans.",
    }


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

@app.errorhandler(Exception)
def unexpected_error(error):
    """Keep API errors JSON-shaped without exposing server internals."""
    if isinstance(error, HTTPException):
        return jsonify({"success": False, "error": error.description}), error.code
    app.logger.exception("Unhandled API error", exc_info=error)
    return jsonify({"success": False, "error": "Internal server error."}), 500

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({
        "success": False,
        "error": f"Request is too large. Maximum size is {MAX_REQUEST_BYTES // (1024 * 1024)} MB.",
    }), 413

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "timestamp": utc_timestamp()})


@app.route("/patients", methods=["GET"])
def list_patients():
    with DB_LOCK:
        patients_list = load_db()["patients"]
    safe = []
    for patient in patients_list:
        safe_patient = {
            k: v
            for k, v in patient.items()
            if k not in ("face_embeddings", "face_embedding", "booking_request_id")
        }
        face_embedding_count = len(patient_embedding_vectors(patient))
        safe_patient["face_embedding_count"] = face_embedding_count
        safe_patient["registered"] = face_embedding_count == REQUIRED_FACE_SAMPLE_COUNT
        safe.append(safe_patient)
    return jsonify({"patients": safe})


@app.route("/checkin-attempts", methods=["GET"])
def list_checkin_attempts():
    with CHECKIN_ATTEMPTS_LOCK:
        attempts = load_checkin_attempts()["attempts"]
    return jsonify({"attempts": attempts})


@app.route("/analyze-face-pose", methods=["POST"])
def analyze_face_pose_route():
    """
    POST /analyze-face-pose
    Body: { "image": "<base64 image string>", "target": "forward|left|right" }
    Returns pose/quality readiness for automatic registration capture.
    """
    data, error_response = json_body()
    if error_response:
        return error_response
    if "image" not in data:
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
    data, error_response = json_body()
    if error_response:
        log_checkin_attempt(success=False, reason="invalid_request", error="A JSON object is required.")
        return error_response
    if "image" not in data:
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
        if err.startswith("No face detected"):
            reason = "no_face"
        elif err.startswith("Multiple faces detected"):
            reason = "multiple_faces"
        else:
            reason = "invalid_image"
        log_checkin_attempt(
            success=False,
            reason=reason,
            error=err,
        )
        return jsonify({"success": False, "error": err}), 422

    # Match against DB
    with DB_LOCK:
        patients_list = load_db()["patients"]
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
    with DB_LOCK:
        # Reload before writing so a concurrent booking is not overwritten.
        db = load_db()
        for p in db["patients"]:
            if p.get("patient_id") == patient.get("patient_id"):
                p["token_issued"] = True
                p["token_issued_at"] = utc_timestamp()
                patient = p
                break
        save_db(db)

    try:
        appt_time = datetime.fromisoformat(patient["appointment_time"].replace("Z", "+00:00"))
        formatted_appointment_time = appt_time.strftime("%d/%m/%Y, %H:%M")
    except (AttributeError, TypeError, ValueError):
        formatted_appointment_time = str(patient.get("appointment_time") or "Not set")
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
            "appointment_time": formatted_appointment_time,
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
    data, error_response = json_body()
    if error_response:
        return error_response
    patient_id = data.get("patient_id")
    images = data.get("images")

    if not isinstance(patient_id, str) or not patient_id.strip():
        return jsonify({"success": False, "error": "patient_id and images are required."}), 400
    patient_id = patient_id.strip()

    image_error = validate_images(images)
    if image_error:
        return jsonify({"success": False, "error": image_error}), 400

    with DB_LOCK:
        patient = next((p for p in load_db()["patients"] if p.get("patient_id") == patient_id), None)
    if not patient:
        return jsonify({"success": False, "error": f"Patient {patient_id} not found."}), 404

    embeddings, face_error = extract_validated_face_set(images)
    if face_error:
        return jsonify({"success": False, **face_error}), 422

    with DB_LOCK:
        db = load_db()
        patient = next((p for p in db["patients"] if p.get("patient_id") == patient_id), None)
        if not patient:
            return jsonify({"success": False, "error": f"Patient {patient_id} not found."}), 404
        embedding_count = set_patient_embeddings(patient, embeddings)
        patient["registered"] = True
        patient["registered_at"] = utc_timestamp()
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
    data, error_response = json_body()
    if error_response:
        return error_response

    required = ["name", "doctor", "department", "appointment_time"]
    fields, field_error = cleaned_text_fields(data, required)
    if field_error:
        return jsonify({"success": False, "error": field_error}), 400

    appointment_error = validate_appointment_time(fields["appointment_time"])
    if appointment_error:
        return jsonify({"success": False, "error": appointment_error}), 400

    images = data.get("images")
    image_error = validate_images(images)
    if image_error:
        return jsonify({"success": False, "error": image_error}), 400

    booking_request_id = data.get("booking_request_id")
    if booking_request_id is not None:
        if not isinstance(booking_request_id, str) or not booking_request_id.strip():
            return jsonify({"success": False, "error": "booking_request_id must be a non-empty string."}), 400
        booking_request_id = booking_request_id.strip()
        if len(booking_request_id) > MAX_TEXT_LENGTH:
            return jsonify({"success": False, "error": "booking_request_id is too long."}), 400

        with DB_LOCK:
            existing = next(
                (p for p in load_db()["patients"] if p.get("booking_request_id") == booking_request_id),
                None,
            )
        if existing:
            return jsonify(booking_response(existing))

    embeddings, face_error = extract_validated_face_set(images)
    if face_error:
        return jsonify({"success": False, **face_error}), 422

    token = f"TKN-{uuid.uuid4().hex[:8].upper()}"
    with DB_LOCK:
        db = load_db()
        # Two same-key requests can finish face processing together; check again
        # inside the write lock before creating a record.
        if booking_request_id:
            existing = next(
                (p for p in db["patients"] if p.get("booking_request_id") == booking_request_id),
                None,
            )
            if existing:
                return jsonify(booking_response(existing))

        patient_number = next_patient_number(db["patients"])
        patient_id = f"PAT-{patient_number:03d}"
        appointment_id = f"APT-{datetime.now(UTC).strftime('%Y')}-{patient_number:04d}"
        timestamp = utc_timestamp()
        new_patient = {
            "patient_id": patient_id,
            "name": fields["name"],
            "appointment_id": appointment_id,
            "appointment_time": fields["appointment_time"],
            "doctor": fields["doctor"],
            "department": fields["department"],
            "digital_token": token,
            "created_at": timestamp,
            "token_issued": False,
            "face_embeddings": [embedding.tolist() for embedding in embeddings],
            "registered": True,
            "registered_at": timestamp,
        }
        if booking_request_id:
            new_patient["booking_request_id"] = booking_request_id

        db["patients"].append(new_patient)
        save_db(db)

    return jsonify(booking_response(new_patient))


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "0.0.0.0")
    port = int(os.getenv("FLASK_PORT", "5050"))
    print(f"🚀 Starting Face Token Service on {host}:{port}")
    debug = os.getenv("FLASK_DEBUG", "False").lower() in ("1", "true", "yes")
    app.run(host=host, port=port, debug=debug)
