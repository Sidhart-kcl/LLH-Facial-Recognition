# MediPass API Reference

Base URL: `http://localhost:5050`

All endpoints return JSON. User-facing date displays use `dd/mm/yyyy, HH:mm`. API input fields and stored JSON timestamps remain ISO 8601 strings so sorting and parsing stay reliable. The `/verify` success response formats `patient.appointment_time` for display as `dd/mm/yyyy, HH:mm`.

## `GET /health`

Health check.

```bash
curl http://localhost:5050/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-07-01T10:30:45+00:00"
}
```

## `GET /patients`

Returns patients for the admin dashboard. Raw face embeddings are excluded.

`registered` is derived from `face_embedding_count === 3`.

```bash
curl http://localhost:5050/patients
```

```json
{
  "patients": [
    {
      "patient_id": "PAT-001",
      "name": "Ahmed Al Mansouri",
      "appointment_id": "APT-2026-0001",
      "appointment_time": "2026-07-15T09:00:00",
      "doctor": "Dr. Sara Hassan",
      "department": "Cardiology",
      "digital_token": "TKN-A1B2C3D4",
      "created_at": "2026-07-01T08:30:00+00:00",
      "token_issued": false,
      "registered": true,
      "registered_at": "2026-07-01T08:32:00+00:00",
      "face_embedding_count": 3
    }
  ]
}
```

## `GET /checkin-attempts`

Returns the check-in attempt log used by the admin dashboard.

```bash
curl http://localhost:5050/checkin-attempts
```

```json
{
  "attempts": [
    {
      "attempt_id": "ATT-1A2B3C4D5E",
      "timestamp": "2026-07-01T09:15:00+00:00",
      "success": true,
      "reason": "matched",
      "confidence": 91.4,
      "threshold": 0.45,
      "patient_id": "PAT-001",
      "appointment_id": "APT-2026-0001",
      "doctor": "Dr. Sara Hassan",
      "department": "Cardiology"
    }
  ]
}
```

Common `reason` values:

- `matched`
- `below_threshold`
- `no_registered_embeddings`
- `no_face`
- `invalid_image`
- `missing_image`

## `POST /book-with-face-set`

Creates a patient appointment and digital token only after exactly three face images are validated. This prevents patient records with partial face registrations.

`appointment_time` is an API input value and should be sent as an ISO-style datetime string. The frontend displays it back to users as `dd/mm/yyyy, HH:mm`.

```bash
curl -X POST http://localhost:5050/book-with-face-set \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Layla Al Mazrouei",
    "doctor": "Dr. Hana Nasser",
    "department": "Pediatrics",
    "appointment_time": "2026-07-15T15:00:00",
    "images": [
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,..."
    ]
  }'
```

Required fields:

- `name`
- `doctor`
- `department`
- `appointment_time`
- `images`: exactly three base64 image strings

Success:

```json
{
  "success": true,
  "patient_id": "PAT-004",
  "appointment_id": "APT-2026-0004",
  "digital_token": "TKN-X9Y0Z1A2",
  "embedding_count": 3,
  "message": "Appointment booked with three registered face scans."
}
```

## `POST /register-face-set`

Replaces an existing patient's face set with exactly three validated embeddings. This endpoint is for re-registration, not appending.

```bash
curl -X POST http://localhost:5050/register-face-set \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "PAT-001",
    "images": [
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,..."
    ]
  }'
```

Required fields:

- `patient_id`
- `images`: exactly three base64 image strings, with or without data URI prefixes

Success:

```json
{
  "success": true,
  "message": "Three face scans registered for Ahmed Al Mansouri.",
  "embedding_count": 3
}
```

Failures:

```json
{
  "success": false,
  "error": "Patient PAT-999 not found."
}
```

## `POST /book` And `POST /register`

These older single-purpose endpoints are disabled because they could create patient records with 0, 1, 2, or more than 3 face samples.

Use:

- `/book-with-face-set` for new patients
- `/register-face-set` for existing-patient re-registration

## `POST /analyze-face-pose`

Analyzes a live registration preview frame and reports whether it is ready to auto-capture for a target angle.

```bash
curl -X POST http://localhost:5050/analyze-face-pose \
  -H "Content-Type: application/json" \
  -d '{
    "target": "left",
    "image": "data:image/jpeg;base64,..."
  }'
```

Required fields:

- `image`: base64 image string, with or without a data URI prefix
- `target`: `forward`, `left`, or `right`

Success:

```json
{
  "ready": true,
  "target": "left",
  "message": "Hold still.",
  "pose": {
    "pitch": 1.8,
    "yaw": -18.6,
    "roll": 2.4
  },
  "quality": {
    "face_area_ratio": 0.142,
    "center_offset": 0.034,
    "detection_score": 0.91,
    "blur_score": 63.4
  },
  "checks": {
    "yaw_ok": true,
    "pitch_ok": true,
    "roll_ok": true,
    "centered": true,
    "large_enough": true,
    "detection_ok": true,
    "sharp_enough": true
  }
}
```

## `POST /verify`

Verifies a face at check-in, returns the token on match, marks the token as issued, and logs the attempt to `checkin_attempts.json`.

The frontend can send an image from the camera or from the upload tab.

```bash
curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
  }'
```

Required fields:

- `image`: base64 image string, with or without a data URI prefix

Success:

```json
{
  "success": true,
  "confidence": 94.2,
  "match_label": "forward_left_average",
  "match_type": "derived_average",
  "token": "TKN-A1B2C3D4",
  "patient": {
    "name": "Ahmed Al Mansouri",
    "patient_id": "PAT-001",
    "appointment_id": "APT-2026-0001",
    "appointment_time": "15/07/2026, 09:00",
    "doctor": "Dr. Sara Hassan",
    "department": "Cardiology"
  }
}
```

Failure:

```json
{
  "success": false,
  "error": "Face not recognised. Please ensure you are registered or speak to reception.",
  "confidence": 32.1
}
```

## Status Codes

| Status | Meaning |
| --- | --- |
| `200` | Request succeeded |
| `400` | Required fields are missing |
| `404` | Patient not found or face did not match above the threshold |
| `422` | Image could not be decoded or no face was detected |

## Confidence Score

The backend calculates cosine similarity between the submitted face embedding and each patient's match vectors.

For patients with the standard three angle samples, the backend compares against seven vectors:

- `forward`
- `left`
- `right`
- `forward_left_average`
- `forward_right_average`
- `left_right_average`
- `all_angles_average`

The highest score from those vectors becomes that patient's score. The final match is the patient with the highest score above the threshold.

- `0-30%`: very low match
- `30-60%`: uncertain
- `60-80%`: likely match
- `80-100%`: strong match

The default threshold is `0.45`, displayed as `45%` in dashboard calculations. Override it with the `SIMILARITY_THRESHOLD` environment variable when starting the backend.

## Patient Record Shape

Stored records in `backend/db/patients.json` include embeddings, but `/patients` hides them.

Dates in stored records are machine-readable ISO strings. The frontend formats them as `dd/mm/yyyy, HH:mm`.

```json
{
  "patient_id": "PAT-001",
  "name": "Ahmed Al Mansouri",
  "appointment_id": "APT-2026-0001",
  "appointment_time": "2026-07-15T09:00:00",
  "doctor": "Dr. Sara Hassan",
  "department": "Cardiology",
  "digital_token": "TKN-A1B2C3D4",
  "created_at": "2026-07-01T08:30:00+00:00",
  "token_issued": false,
  "face_embeddings": [
    [0.123, -0.456],
    [0.234, -0.567],
    [0.345, -0.678]
  ],
  "registered": true,
  "registered_at": "2026-07-01T08:32:00+00:00",
  "token_issued_at": "2026-07-01T09:15:00+00:00"
}
```

`face_embeddings` stores full 512-dimensional vectors. The short arrays above are only for readability.

## cURL Image Testing

```bash
BASE64_IMG=$(base64 -i /path/to/photo.jpg)

curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$BASE64_IMG\"}"
```

## Production Notes

Production authentication, rate limiting, HTTPS, and stronger storage are not built into this demo API yet. Add them before using real patient data.
