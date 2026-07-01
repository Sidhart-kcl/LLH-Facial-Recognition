# MediPass - Digital Token Appointment System

A local facial-recognition appointment and check-in demo. Patients book an appointment, register one or more face photos, then check in later by camera capture or image upload to retrieve their digital token.

```text
Patient books appointment
        |
Register face sample(s)
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

## Prerequisites

- Python 3.9+
- Node.js 18+ and npm
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
npm install
npm run dev
```

Frontend URL: `http://localhost:5173`

## Current Workflow

### Book And Register

Use the React app:

1. Open `http://localhost:5173`.
2. Choose **Book Appointment**.
3. Enter patient and appointment details.
4. Register a face using camera capture or upload.
5. The backend creates the patient, stores the face embedding, and returns the token.

You can also use the API directly:

```bash
curl -X POST http://localhost:5050/book \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Layla Al Mazrouei",
    "doctor": "Dr. Hana Nasser",
    "department": "Pediatrics",
    "appointment_time": "2026-07-15T15:00:00"
  }'
```

Then append a face sample for that patient:

```bash
python scripts/get_embedding.py --patient_id PAT-001 --image ~/photo.jpg
```

Each registration appends a new embedding. A patient can have multiple registered face samples, for example straight, slightly left, and slightly right.

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
- Registered patients
- Tokens issued
- Today's check-ins
- Check-in success rate
- Average successful and failed match confidence
- Most common failure reason
- Patients missing face registration
- Average face samples per patient
- Average days booked in advance
- Failure reasons, check-ins over time, department breakdown, risky matches, unregistered patients, and repeated failures

A patient is considered registered when `face_embedding_count > 0`.

## API Endpoints

- `GET /health`: backend health check
- `GET /patients`: patient list for admin use, excluding raw embeddings
- `GET /checkin-attempts`: check-in attempt log for admin analytics
- `POST /book`: create an appointment and patient record
- `POST /register`: append one face embedding to an existing patient
- `POST /verify`: verify a face, return the token on match, and log the attempt

See `API.md` for request and response examples.

## Demo Data

For realistic test data, use the selected VGGFace2 folders in `backend/demo_seed/faces`:

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
python demo_seed/seed_from_faces.py --reset-all
python demo_seed/seed_from_faces.py --clear-seeded-only
python demo_seed/seed_from_faces.py --clear-all-only
```

## Configuration

### Similarity Threshold

In `backend/face_service.py`:

```python
SIMILARITY_THRESHOLD = 0.45
```

Lower values are more permissive. Higher values are stricter. Tune this with your own registration and check-in photos.

### CORS Origins

In `backend/face_service.py`:

```python
CORS(app, origins=["http://localhost:5173"])
```

Add the deployed frontend origin before production use.

## Troubleshooting

### Camera access denied

- Allow camera access in the browser.
- Use `http://localhost` during local development.
- Use HTTPS for deployed camera access.

### No face detected

- Use a clearer image with one visible face.
- Improve lighting.
- Center the face and move closer to the camera.
- Try the upload tab with a known clear image.

### Face not recognised

- Confirm the patient has at least one face sample.
- Add more samples for that patient using `/register` or the CLI.
- Check the match confidence in the admin dashboard.
- Tune `SIMILARITY_THRESHOLD` if needed.

### Cannot reach the server

- Confirm `python face_service.py` is running on port `5050`.
- Confirm the frontend is using `http://localhost:5050`.
- Check CORS if you changed frontend ports.

## File Structure

```text
face-token-system/
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
- For thousands of patients with multiple samples each, move to a vector index such as FAISS, HNSW, or a database with vector search.

## Production Notes

Before real deployment:

- Add authentication and authorization to admin and write endpoints.
- Serve over HTTPS.
- Replace JSON files with a real database.
- Protect, rotate, and back up patient and attempt data.
- Add rate limiting and audit logging.
- Validate privacy, consent, and compliance requirements for your environment.
