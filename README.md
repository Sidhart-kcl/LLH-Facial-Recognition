# MediPass - Digital Token Appointment System

A local facial-recognition appointment and check-in demo. Patients book an appointment, complete a required three-angle face registration, then check in later by camera capture or image upload to retrieve their digital token.

```text
Patient books appointment
        |
Register three face samples
        |
Check in with camera or uploaded image
        |
Return digital token and log the attempt
```

## Architecture

- **Backend**: Flask + InsightFace in `backend/face_service.py`
- **Frontend**: React + Vite in `frontend/src`
- **Storage**: local JSON files in `backend/db`
- **Face recognition**: InsightFace `buffalo_l` model, 512-dimensional embeddings
- **Admin dashboard**: connected in the frontend and backed by `/patients` and `/checkin-attempts`

The JSON database files are intentionally local-only and ignored by git:

- `backend/db/patients.json`
- `backend/db/checkin_attempts.json`

They start empty unless you book patients through the app or run the demo seeder.

Dates shown to users are formatted as `dd/mm/yyyy, HH:mm`. API input fields and JSON database timestamps use ISO strings internally for reliable parsing and sorting.

## Prerequisites

- Python 3.10+
- A supported Node.js LTS release (Node.js 22.12+; Node.js 24 recommended)
- Webcam for camera capture, or image files for upload testing
- About 500MB disk space for the InsightFace model

## Backend Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python face_service.py
```

On first startup, InsightFace downloads the `buffalo_l` model. That can take a few minutes.

Backend URL: `http://localhost:5050`

## Frontend Setup

```bash
cd frontend
npm ci
npm run dev
```

Frontend URL: `http://localhost:5173`

## Current Workflow

### Book And Register

Use the React app:

1. Open `http://localhost:5173`.
2. Choose **Book Appointment**.
3. Enter patient and appointment details.
4. Complete the guided three-angle face scan: straight, slightly left, and slightly right.
5. The backend creates the patient, stores the three face embeddings, and returns the token.

You can also use the API directly:

`appointment_time` is sent in ISO format because it is an API input value. The app displays appointment dates back to users as `dd/mm/yyyy, HH:mm`.

```bash
curl -X POST http://localhost:5050/book-with-face-set \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Layla Al Mazrouei",
    "doctor": "Dr. Hana Nasser",
    "department": "Pediatrics",
    "appointment_time": "2026-09-15T15:00:00",
    "booking_request_id": "example-booking-001",
    "images": [
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,...",
      "data:image/jpeg;base64,..."
    ]
  }'
```

The browser uses `/analyze-face-pose` during registration to auto-capture each angle when the face is centered, large enough, stable, and turned to the requested angle. The final booking and re-registration endpoints repeat those quality and pose checks server-side; three arbitrary images are not accepted as a valid set.

You can also replace the three-scan face set manually for an existing patient:

```bash
python scripts/get_embedding.py --patient_id PAT-001 --images forward.jpg left.jpg right.jpg
```

Face registration requires exactly three samples. The old single-image registration path is disabled.

API clients should send a stable `booking_request_id` for each intended booking. Retrying with the same ID returns the original record instead of creating a duplicate.

### Check In

1. Choose **Check In** in the React app.
2. Start face scan.
3. Use **Capture** for webcam or **Upload** for a saved image.
4. The backend compares the submitted face against each patient's angle-aware match set.
5. On success, the token is shown and the attempt is logged.

For patients with the standard three VGGFace2 registration images, the match set has seven vectors:

- `forward`
- `left`
- `right`
- `forward_left_average`
- `forward_right_average`
- `left_right_average`
- `all_angles_average`

The best of those seven scores becomes that patient's score. The backend then picks the best patient score across all patients.

Every `/verify` request appends a record to `backend/db/checkin_attempts.json`, including success/failure, reason, confidence, threshold, timestamp, and matched patient details when available.

### Admin Dashboard

The admin dashboard is available from the main app navigation. It shows live data from the JSON files, including:

- Total patients
- Upcoming appointments
- Tokens issued
- Today's check-in attempts
- Today's successful check-ins
- Check-in success rate
- Average successful and failed match confidence
- Most common failure reason
- Average days booked in advance
- Low-confidence successes and near-miss failures
- Failure reasons, check-ins over time, department breakdown, risky matches, repeated failures, and clickable stat drill-down tables

A patient is considered registered only when `face_embedding_count === 3`.

## API Endpoints

- `GET /health`: backend health check
- `GET /patients`: patient list for admin use, excluding raw embeddings
- `GET /checkin-attempts`: check-in attempt log for admin analytics
- `POST /book-with-face-set`: create an appointment only after exactly three face scans are valid
- `POST /analyze-face-pose`: check whether a preview frame is ready for a target registration angle
- `POST /register-face-set`: replace an existing patient's face set with exactly three valid scans
- `POST /verify`: verify a face, return the token on match, and log the attempt

See `API.md` for request and response examples.

## Demo Data

For realistic test data, use the selected VGGFace2 folders in `backend/demo_seed/faces`:

Optional test faces download:

- Faces folder: `https://drive.google.com/file/d/1Aanje7P3Povb9eFDx-qbOnW98_RQnQaL/view?usp=sharing`

After downloading, place or extract the folders into `backend/demo_seed/faces`.

```text
backend/demo_seed/faces/
  Person_Name/
    forward.jpg
    left.jpg
    right.jpg
    remaining/
```

Then run:

```bash
cd backend
source venv/bin/activate
python demo_seed/seed_from_faces.py
```

By default the seeder clears previous records that it created, keeps non-demo records, generates real InsightFace embeddings, and creates dashboard-friendly check-in attempt logs.

Useful options:

```bash
python demo_seed/seed_from_faces.py --dry-run
python demo_seed/seed_from_faces.py --clear-all
python demo_seed/seed_from_faces.py --clear-seeded-only
python demo_seed/seed_from_faces.py --clear-all-only
```

## Configuration

### Similarity Threshold

The backend reads the threshold from `SIMILARITY_THRESHOLD`, defaulting to `0.45`:

```bash
SIMILARITY_THRESHOLD=0.45 python face_service.py
```

Lower values are more permissive. Higher values are stricter. Tune this with your own registration and check-in photos.

The three registration samples must also exceed the pairwise `REGISTRATION_SIMILARITY_THRESHOLD`, defaulting to `0.20`. This prevents a face set assembled from different people. Tune both thresholds with representative data rather than interpreting cosine similarity as a probability.

### Camera Yaw Calibration

`POSE_YAW_SIGN` controls lateral pose interpretation and accepts `-1` or `1`. It defaults to `-1`. Test the guided left and right scans on the registration camera; if the prompts are reversed, restart the backend with the other value:

```bash
POSE_YAW_SIGN=1 python face_service.py
```

This is a camera/deployment calibration, so the automated tests work with either value instead of enforcing one sign. A shared backend serving differently oriented cameras requires per-device calibration before production use.

### CORS Origins

The backend reads allowed frontend origins from `CORS_ORIGINS`, defaulting to `http://localhost:5173`:

```bash
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 python face_service.py
```

Add the deployed frontend origin before production use.

### Request Limits

Requests default to 20 MB and each decoded image to 6 MB. Override these with `MAX_REQUEST_BYTES` and `MAX_IMAGE_BYTES` (both in bytes).

`backend/.env.example` documents every supported backend variable. The app reads environment variables from the process; it does not automatically load that file.

## Automated Checks

```bash
backend/venv/bin/python -m unittest discover -s backend/tests -v
cd frontend && npm run lint && npm run build
```

The API tests use a fake face model and temporary JSON files, so they do not load InsightFace or alter local demo data.

## Troubleshooting

### Camera access denied

- Allow camera access in the browser.
- Use `http://localhost` during local development.
- Use HTTPS for deployed camera access.

### Left and right prompts are reversed

- Stop the backend, change `POSE_YAW_SIGN` from `-1` to `1` or from `1` to `-1`, then restart it.
- Repeat a complete forward/left/right registration smoke test on that camera.

### No face detected

- Use a clearer image with one visible face.
- Improve lighting.
- Center the face and move closer to the camera.
- Try the upload tab with a known clear image.

### Face not recognised

- Confirm the patient has exactly three face samples.
- Re-register the full three-scan face set using `/register-face-set` or the CLI.
- Check the match confidence in the admin dashboard.
- Tune the `SIMILARITY_THRESHOLD` environment variable if needed.

### Cannot reach the server

- Confirm `python face_service.py` is running on port `5050`.
- Confirm the frontend is using `http://localhost:5050`.
- Check CORS if you changed frontend ports.

## File Structure

```text
project-root/
├── backend/
│   ├── db/
│   │   ├── patients.json              # local ignored patient DB
│   │   └── checkin_attempts.json      # local ignored attempt log
│   ├── demo_seed/
│   │   ├── faces/                     # selected VGGFace2 folders
│   │   └── seed_from_faces.py
│   ├── scripts/
│   │   └── get_embedding.py           # CLI face registration
│   ├── face_service.py                # Flask API
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # main UI and check-in flow
│   │   ├── BookingFlow.jsx            # booking and registration flow
│   │   ├── AdminDashboard.jsx         # connected analytics dashboard
│   │   ├── main.jsx
│   │   └── index.css
│   └── package.json
```

## Performance Notes

- Face extraction depends on CPU and image size.
- Matching is currently a linear search over each patient's real and derived face vectors, not just patients.
- This is fine for demo and small pilot datasets.
- For thousands of patients with seven match vectors each, move to a vector index such as FAISS, HNSW, or a database with vector search.

## Production Readiness

This repository is a local demo, not a production-ready medical or biometric system. The admin and write APIs have no authentication, and the JSON store is intended for one backend process only. Do not expose the service publicly or use real patient data as-is.

Before real deployment:

- Add authentication and authorization to admin and write endpoints.
- Serve over HTTPS.
- Replace JSON files with a real database.
- Protect, rotate, and back up patient and attempt data.
- Add rate limiting and audit logging.
- Validate privacy, consent, and compliance requirements for your environment.
