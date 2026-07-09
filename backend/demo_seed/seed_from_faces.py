"""
Seed demo patients from the selected VGGFace2 face folders.

This script is intentionally separate from the Flask app. It reads image files,
extracts real InsightFace embeddings, and writes demo records into:

- backend/db/patients.json
- backend/db/checkin_attempts.json

Expected layout:

faces/Person_Name/
  forward.jpg
  left.jpg
  right.jpg
  remaining/
"""

from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_FACES_DIR = Path(__file__).resolve().parent / "faces"
DEFAULT_PATIENTS_DB = BACKEND_DIR / "db" / "patients.json"
DEFAULT_ATTEMPTS_DB = BACKEND_DIR / "db" / "checkin_attempts.json"
SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
SELECTED_REGISTRATION_STEMS = ("forward", "left", "right")
REQUIRED_FACE_SAMPLE_COUNT = 3
DEPARTMENTS = [
    "Cardiology",
    "Dermatology",
    "General",
    "Neurology",
    "Orthopedics",
    "Pediatrics",
]
DOCTORS = [
    "Dr. Sara Hassan",
    "Dr. Omar Khalid",
    "Dr. Hana Nasser",
    "Dr. Maya Thomas",
    "Dr. Ahmed Saleh",
    "Dr. Lina Farouk",
]
DEMO_SOURCE = "demo_seed"
SIMILARITY_THRESHOLD = 0.45


@dataclass(frozen=True)
class Subject:
    seed_index: int
    patient_id: str
    name: str
    image_paths: list[Path]


def iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat()


def local_now() -> datetime:
    return datetime.now().astimezone().replace(microsecond=0)


def today_attempt_time(now: datetime, index: int) -> datetime:
    """Keep seeded dashboard daily metrics populated without dating attempts in the future."""
    today_start = now.replace(hour=0, minute=5, second=0, microsecond=0)
    elapsed_minutes = max(0, int((now - today_start).total_seconds() // 60))
    if elapsed_minutes == 0:
        return now
    minutes_back = min(index * 6, elapsed_minutes)
    return now - timedelta(minutes=minutes_back)


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default

    with path.open("r") as f:
        data = json.load(f)

    if isinstance(data, list):
        if "patients" in default:
            return {"patients": data}
        if "attempts" in default:
            return {"attempts": data}

    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(data, f, indent=2)


def backup(path: Path) -> Path | None:
    if not path.exists():
        return None

    stamp = local_now().strftime("%d%m%Y-%H%M%S")
    backup_path = path.with_suffix(path.suffix + f".bak-{stamp}")
    shutil.copy2(path, backup_path)
    return backup_path


def image_files_in(path: Path) -> list[Path]:
    if not path.exists():
        return []

    return sorted(
        file
        for file in path.iterdir()
        if file.is_file() and file.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS
    )


def selected_registration_images(folder: Path) -> list[Path]:
    images_by_stem = {
        file.stem.lower(): file
        for file in image_files_in(folder)
    }
    return [
        images_by_stem[stem]
        for stem in SELECTED_REGISTRATION_STEMS
        if stem in images_by_stem
    ]


def display_name_from_stem(stem: str, patient_id: str) -> str:
    clean = re.sub(r"[_-]+", " ", stem).strip()
    if re.fullmatch(r"p\d+", stem, flags=re.IGNORECASE):
        return f"Demo Patient {stem[1:]}"
    if clean and not re.fullmatch(r"demo\s*\d+", clean, flags=re.IGNORECASE):
        return clean.title()
    return f"Demo Patient {patient_id.split('-')[-1]}"


def patient_id_from_stem(stem: str, seed_index: int) -> str:
    normalized = stem.upper().replace(" ", "-")
    if re.fullmatch(r"P\d{3,}", normalized):
        return normalized
    if re.fullmatch(r"PAT-\d{3,}", normalized):
        return normalized
    return f"DEMO-{seed_index:03d}"


def discover_subjects(faces_dir: Path) -> list[Subject]:
    subjects: list[Subject] = []
    seed_index = 1

    for folder in sorted(path for path in faces_dir.iterdir() if path.is_dir()) if faces_dir.exists() else []:
        images = selected_registration_images(folder)
        if len(images) != REQUIRED_FACE_SAMPLE_COUNT:
            print(f"Skipping {folder.name}: expected exactly 3 selected registration images.")
            continue

        patient_id = patient_id_from_stem(folder.name, seed_index)
        subjects.append(Subject(
            seed_index=seed_index,
            patient_id=patient_id,
            name=display_name_from_stem(folder.name, patient_id),
            image_paths=images,
        ))
        seed_index += 1

    return subjects


def load_face_model():
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(640, 640))
    return app


def extract_embedding(face_app, image_path: Path) -> list[float] | None:
    import cv2

    img = cv2.imread(str(image_path))
    if img is None:
        print(f"Skipping unreadable image: {image_path}")
        return None

    faces = face_app.get(img)
    if not faces:
        print(f"No face detected: {image_path}")
        return None

    if len(faces) > 1:
        print(f"Multiple faces detected, using largest face: {image_path}")
        faces = sorted(
            faces,
            key=lambda face: (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]),
            reverse=True,
        )

    return faces[0].normed_embedding.tolist()


def create_patient(subject: Subject, embeddings: list[list[float]], now: datetime) -> dict[str, Any]:
    if len(embeddings) != REQUIRED_FACE_SAMPLE_COUNT:
        raise ValueError("Demo patients must have exactly three face embeddings.")

    department = DEPARTMENTS[(subject.seed_index - 1) % len(DEPARTMENTS)]
    doctor = DOCTORS[(subject.seed_index - 1) % len(DOCTORS)]
    appointment_offset_days = (subject.seed_index % 21) - 4
    appointment_hour = 8 + (subject.seed_index % 9)
    appointment_time = (now + timedelta(days=appointment_offset_days)).replace(
        hour=appointment_hour,
        minute=0,
        second=0,
        microsecond=0,
    )
    lead_days = 2 + (subject.seed_index % 14)
    created_at = appointment_time - timedelta(days=lead_days)
    appointment_id = f"APT-2026-DEMO-{subject.seed_index:04d}"
    token = f"TKN-{uuid.uuid5(uuid.NAMESPACE_DNS, subject.patient_id).hex[:8].upper()}"

    return {
        "patient_id": subject.patient_id,
        "name": subject.name,
        "appointment_id": appointment_id,
        "appointment_time": iso(appointment_time),
        "created_at": iso(created_at),
        "doctor": doctor,
        "department": department,
        "digital_token": token,
        "token_issued": False,
        "face_embeddings": embeddings,
        "registered": bool(embeddings),
        "registered_at": iso(now) if embeddings else None,
        "source": DEMO_SOURCE,
        "demo_image_count": len(subject.image_paths),
    }


def create_attempt(
    *,
    patient: dict[str, Any] | None,
    timestamp: datetime,
    success: bool,
    reason: str,
    confidence: float | None,
    error: str | None = None,
) -> dict[str, Any]:
    attempt = {
        "attempt_id": f"ATT-{uuid.uuid4().hex[:10].upper()}",
        "timestamp": iso(timestamp),
        "success": success,
        "reason": reason,
        "confidence": confidence,
        "threshold": SIMILARITY_THRESHOLD,
        "source": DEMO_SOURCE,
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

    return attempt


def create_demo_attempts(patients: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []

    for index, patient in enumerate(patients, start=1):
        if index <= 18:
            timestamp = today_attempt_time(now, index)
        else:
            timestamp = now - timedelta(hours=(index * 3) % 72, minutes=(index * 7) % 60)
        has_faces = len(patient.get("face_embeddings", [])) == REQUIRED_FACE_SAMPLE_COUNT

        if not has_faces:
            attempts.append(create_attempt(
                patient=patient,
                timestamp=timestamp,
                success=False,
                reason="no_registered_embeddings",
                confidence=0.0,
                error="No registered face samples for this patient.",
            ))
            continue

        if index % 10 == 0:
            confidence = round(random.uniform(48.0, 54.9), 1)
            success = confidence >= SIMILARITY_THRESHOLD * 100
            attempts.append(create_attempt(
                patient=patient,
                timestamp=timestamp,
                success=success,
                reason="matched" if success else "below_threshold",
                confidence=confidence,
                error=None if success else "Face not recognised.",
            ))
            patient["token_issued"] = success
            if success:
                patient["token_issued_at"] = iso(timestamp)
        elif index % 4 == 0:
            attempts.append(create_attempt(
                patient=patient,
                timestamp=timestamp,
                success=False,
                reason="below_threshold",
                confidence=round(random.uniform(18.0, 44.0), 1),
                error="Face not recognised. Please ensure you are registered or speak to reception.",
            ))
        else:
            confidence = round(random.uniform(76.0, 98.5), 1)
            attempts.append(create_attempt(
                patient=patient,
                timestamp=timestamp,
                success=True,
                reason="matched",
                confidence=confidence,
            ))
            patient["token_issued"] = True
            patient["token_issued_at"] = iso(timestamp)

        if index % 9 == 0:
            attempts.append(create_attempt(
                patient=patient,
                timestamp=timestamp + timedelta(minutes=2),
                success=False,
                reason="below_threshold",
                confidence=round(random.uniform(36.0, 44.9), 1),
                error="Face not recognised. Please ensure you are registered or speak to reception.",
            ))

    for offset, reason in enumerate(["no_face", "invalid_image", "missing_image"], start=1):
        attempts.append(create_attempt(
            patient=None,
            timestamp=today_attempt_time(now, offset + 18),
            success=False,
            reason=reason,
            confidence=None,
            error={
                "no_face": "No face detected. Please look directly at the camera.",
                "invalid_image": "Could not decode image.",
                "missing_image": "No image provided.",
            }[reason],
        ))

    return attempts


def build_demo_patients(subjects: list[Subject], now: datetime) -> list[dict[str, Any]]:
    face_app = load_face_model()
    patients: list[dict[str, Any]] = []

    for subject in subjects:
        embeddings = []
        for image_path in subject.image_paths:
            embedding = extract_embedding(face_app, image_path)
            if embedding is not None:
                embeddings.append(embedding)

        if len(embeddings) != REQUIRED_FACE_SAMPLE_COUNT:
            print(
                f"Skipping {subject.patient_id}: {subject.name} "
                f"({len(embeddings)}/{REQUIRED_FACE_SAMPLE_COUNT} usable face samples)"
            )
            continue

        patients.append(create_patient(subject, embeddings, now))
        print(
            f"{subject.patient_id}: {subject.name} "
            f"({len(embeddings)}/{len(subject.image_paths)} usable face samples)"
        )

    return patients


def remove_seeded_data(
    patients_db: dict[str, Any],
    attempts_db: dict[str, Any],
) -> tuple[int, int]:
    original_patients = patients_db.get("patients", [])
    original_attempts = attempts_db.get("attempts", [])

    patients_db["patients"] = [
        patient
        for patient in original_patients
        if patient.get("source") != DEMO_SOURCE
    ]
    attempts_db["attempts"] = [
        attempt
        for attempt in original_attempts
        if attempt.get("source") != DEMO_SOURCE
    ]

    return (
        len(original_patients) - len(patients_db["patients"]),
        len(original_attempts) - len(attempts_db["attempts"]),
    )


def clear_all_data(patients_db: dict[str, Any], attempts_db: dict[str, Any]) -> tuple[int, int]:
    patient_count = len(patients_db.get("patients", []))
    attempt_count = len(attempts_db.get("attempts", []))
    patients_db["patients"] = []
    attempts_db["attempts"] = []
    return patient_count, attempt_count


def load_and_backup_databases(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    patients_db = load_json(args.patients_db, {"patients": []})
    attempts_db = load_json(args.attempts_db, {"attempts": []})

    patient_backup = backup(args.patients_db)
    attempts_backup = backup(args.attempts_db)
    if patient_backup:
        print(f"Backed up patients DB: {patient_backup}")
    if attempts_backup:
        print(f"Backed up attempts DB: {attempts_backup}")

    return patients_db, attempts_db


def write_databases(args: argparse.Namespace, patients_db: dict[str, Any], attempts_db: dict[str, Any]) -> None:
    write_json(args.patients_db, patients_db)
    write_json(args.attempts_db, attempts_db)


def seed(args: argparse.Namespace) -> int:
    if args.clear_all_only and args.clear_seeded_only:
        print("Choose only one clear-only mode.")
        return 2

    if args.clear_all_only or args.clear_seeded_only:
        patients_db, attempts_db = load_and_backup_databases(args)
        if args.clear_all_only:
            patient_count, attempt_count = clear_all_data(patients_db, attempts_db)
            mode = "all"
        else:
            patient_count, attempt_count = remove_seeded_data(patients_db, attempts_db)
            mode = "seeded"

        write_databases(args, patients_db, attempts_db)
        print(f"Cleared {mode} data without seeding.")
        print(f"Patients removed: {patient_count}")
        print(f"Check-in attempts removed: {attempt_count}")
        return 0

    faces_dir = args.faces_dir.resolve()
    subjects = discover_subjects(faces_dir)

    print(f"Faces directory: {faces_dir}")
    print(f"Detected subjects: {len(subjects)}")

    if not subjects:
        print("No face images found. Drop images into backend/demo_seed/faces and run again.")
        return 0 if args.dry_run else 1

    if args.dry_run:
        for subject in subjects:
            print(f"Would seed {subject.patient_id}: {subject.name} ({len(subject.image_paths)} images)")
        return 0

    random.seed(args.seed)
    now = local_now()
    patients_db, attempts_db = load_and_backup_databases(args)

    if args.reset_all:
        removed_patients, removed_attempts = clear_all_data(patients_db, attempts_db)
        print(f"Cleared all existing data before seeding ({removed_patients} patients, {removed_attempts} attempts).")
    else:
        removed_patients, removed_attempts = remove_seeded_data(patients_db, attempts_db)
        print(f"Cleared previous seeded data before seeding ({removed_patients} patients, {removed_attempts} attempts).")

    demo_patients = build_demo_patients(subjects, now)

    demo_attempts = [] if args.skip_attempts else create_demo_attempts(demo_patients, now)

    patients_db["patients"].extend(demo_patients)
    attempts_db["attempts"].extend(demo_attempts)

    write_databases(args, patients_db, attempts_db)

    registered = sum(
        1
        for patient in demo_patients
        if len(patient.get("face_embeddings", [])) == REQUIRED_FACE_SAMPLE_COUNT
    )
    print("Seed complete.")
    print(f"Demo patients written: {len(demo_patients)}")
    print(f"Registered demo patients: {registered}")
    print(f"Demo check-in attempts written: {len(demo_attempts)}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed demo patients from face image folders.")
    parser.add_argument("--faces-dir", type=Path, default=DEFAULT_FACES_DIR)
    parser.add_argument("--patients-db", type=Path, default=DEFAULT_PATIENTS_DB)
    parser.add_argument("--attempts-db", type=Path, default=DEFAULT_ATTEMPTS_DB)
    parser.add_argument("--skip-attempts", action="store_true", help="Only seed patients; do not seed check-in attempts.")
    parser.add_argument(
        "--reset-all",
        "--clear-all",
        dest="reset_all",
        action="store_true",
        help="Clear all patient and attempt data, then seed demo data.",
    )
    parser.add_argument("--clear-all-only", action="store_true", help="Clear all patients and attempts, then exit without seeding.")
    parser.add_argument("--clear-seeded-only", action="store_true", help="Clear only previous demo_seed records, then exit without seeding.")
    parser.add_argument("--dry-run", action="store_true", help="Show detected subjects without writing JSON files.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for generated demo attempt stats.")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(seed(parse_args()))
