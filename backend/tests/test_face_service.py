"""Fast API regression tests that do not load the real InsightFace model."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

import cv2
import numpy as np


class DummyFaceAnalysis:
    def __init__(self, *args, **kwargs):
        self.calls = 0

    def prepare(self, *args, **kwargs):
        return None

    def get(self, _image):
        return []


fake_insightface = types.ModuleType("insightface")
fake_insightface_app = types.ModuleType("insightface.app")
fake_insightface_app.FaceAnalysis = DummyFaceAnalysis
fake_insightface.app = fake_insightface_app
sys.modules.setdefault("insightface", fake_insightface)
sys.modules.setdefault("insightface.app", fake_insightface_app)

MODULE_PATH = Path(__file__).resolve().parents[1] / "face_service.py"
SPEC = importlib.util.spec_from_file_location("medipass_face_service_for_tests", MODULE_PATH)
service = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(service)


class DummyFace:
    def __init__(self, raw_yaw: float = 0, embedding=None):
        self.bbox = np.array([50, 40, 250, 240], dtype=np.float32)
        self.pose = np.array([0, raw_yaw, 0], dtype=np.float32)
        self.det_score = 0.99
        self.normed_embedding = np.asarray(
            embedding if embedding is not None else [1.0, 0.0, 0.0],
            dtype=np.float32,
        )


class SequencedFaceApp:
    """Return poses accepted by the active camera calibration."""

    def __init__(self):
        self.calls = 0

    def get(self, _image):
        raw_yaws = tuple(valid_raw_yaw(target) for target in service.ANGLE_SAMPLE_LABELS)
        face = DummyFace(raw_yaws[self.calls % len(raw_yaws)])
        self.calls += 1
        return [face]


class StaticFaceApp:
    def __init__(self, faces):
        self.faces = faces

    def get(self, _image):
        return self.faces


class MismatchedFaceApp(SequencedFaceApp):
    def get(self, _image):
        raw_yaws = tuple(valid_raw_yaw(target) for target in service.ANGLE_SAMPLE_LABELS)
        embeddings = ([1, 0, 0], [1, 0, 0], [0, 1, 0])
        face = DummyFace(raw_yaws[self.calls], embeddings[self.calls])
        self.calls += 1
        return [face]


def valid_raw_yaw(target: str) -> float:
    """Choose a raw yaw that remains valid for either camera sign setting."""
    yaw_min, yaw_max = service.POSE_TARGETS[target]["yaw"]
    adjusted_yaw = (yaw_min + yaw_max) / 2
    return adjusted_yaw / service.POSE_YAW_SIGN


def encoded_test_image() -> str:
    rng = np.random.default_rng(42)
    image = rng.integers(0, 256, size=(300, 300, 3), dtype=np.uint8)
    success, encoded = cv2.imencode(".jpg", image)
    assert success
    return base64.b64encode(encoded.tobytes()).decode("ascii")


class FaceServiceApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        directory = Path(self.temporary_directory.name)
        service.DB_DIR = str(directory)
        service.DB_PATH = str(directory / "patients.json")
        service.CHECKIN_ATTEMPTS_PATH = str(directory / "checkin_attempts.json")
        service.face_app = SequencedFaceApp()
        service.app.config.update(TESTING=True)
        self.client = service.app.test_client()
        self.image = encoded_test_image()

    def tearDown(self):
        self.temporary_directory.cleanup()

    def booking_payload(self, **overrides):
        payload = {
            "name": "  Test Patient  ",
            "doctor": "  Dr. Test  ",
            "department": "General",
            "appointment_time": "2030-08-20T10:30:00",
            "booking_request_id": "test-request-1",
            "images": [self.image, self.image, self.image],
        }
        payload.update(overrides)
        return payload

    def test_malformed_body_returns_json_error(self):
        response = self.client.post(
            "/book-with-face-set",
            data="not json",
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.content_type, "application/json")
        self.assertEqual(response.get_json()["error"], "A JSON object is required.")

    def test_booking_validates_text_and_datetime_before_face_processing(self):
        response = self.client.post(
            "/book-with-face-set",
            json=self.booking_payload(name="   ", appointment_time="20/08/2030 10:30"),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(service.face_app.calls, 0)

        response = self.client.post(
            "/book-with-face-set",
            json=self.booking_payload(appointment_time="20/08/2030 10:30"),
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("ISO 8601", response.get_json()["error"])
        self.assertEqual(service.face_app.calls, 0)

    def test_booking_is_idempotent_and_hides_internal_request_id(self):
        payload = self.booking_payload()
        first = self.client.post("/book-with-face-set", json=payload)
        second = self.client.post("/book-with-face-set", json=payload)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.get_json()["patient_id"], second.get_json()["patient_id"])
        self.assertEqual(service.face_app.calls, 3)

        stored = json.loads(Path(service.DB_PATH).read_text())
        self.assertEqual(len(stored["patients"]), 1)
        self.assertEqual(stored["patients"][0]["name"], "Test Patient")

        public_patient = self.client.get("/patients").get_json()["patients"][0]
        self.assertNotIn("booking_request_id", public_patient)
        self.assertNotIn("face_embeddings", public_patient)

    def test_patient_ids_do_not_collide_after_records_are_removed(self):
        Path(service.DB_PATH).write_text(json.dumps({
            "patients": [{
                "patient_id": "PAT-010",
                "appointment_id": "APT-2030-0010",
                "digital_token": "TKN-OLD",
            }],
        }))

        response = self.client.post(
            "/book-with-face-set",
            json=self.booking_payload(booking_request_id="test-request-2"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["patient_id"], "PAT-011")

    def test_registration_rejects_wrong_pose(self):
        Path(service.DB_PATH).write_text(json.dumps({
            "patients": [{"patient_id": "PAT-001", "name": "Test Patient"}],
        }))
        service.face_app = StaticFaceApp([DummyFace(raw_yaw=0)])

        response = self.client.post("/register-face-set", json={
            "patient_id": "PAT-001",
            "images": [self.image, self.image, self.image],
        })

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["target"], "left")

    def test_booking_rejects_images_from_different_people(self):
        service.face_app = MismatchedFaceApp()

        response = self.client.post("/book-with-face-set", json=self.booking_payload())

        self.assertEqual(response.status_code, 422)
        self.assertIn("same person", response.get_json()["error"])
        self.assertFalse(Path(service.DB_PATH).exists())

    def test_verification_rejects_and_logs_multiple_faces(self):
        service.face_app = StaticFaceApp([DummyFace(), DummyFace()])

        response = self.client.post("/verify", json={"image": self.image})

        self.assertEqual(response.status_code, 422)
        attempts = json.loads(Path(service.CHECKIN_ATTEMPTS_PATH).read_text())["attempts"]
        self.assertEqual(attempts[0]["reason"], "multiple_faces")


if __name__ == "__main__":
    unittest.main()
