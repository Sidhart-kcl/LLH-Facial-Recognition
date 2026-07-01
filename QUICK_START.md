# MediPass Quick Start Guide

## 5-Minute Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python face_service.py
```

The first backend run may download the InsightFace `buffalo_l` model.

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## What You Get

```text
face-token-system/
├── backend/
│   ├── face_service.py              # Flask API
│   ├── db/
│   │   ├── patients.json            # local ignored patient DB
│   │   └── checkin_attempts.json    # local ignored check-in attempt log
│   ├── demo_seed/
│   │   └── seed_from_faces.py       # optional test data seeder
│   ├── scripts/
│   │   └── get_embedding.py         # CLI face registration helper
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # main app, navigation, check-in
│   │   ├── BookingFlow.jsx          # booking and face registration
│   │   └── AdminDashboard.jsx       # connected admin analytics
│   └── package.json
```

## First Run

The project does not ship with tracked patient data. The local JSON files start empty.

Use one of these paths:

1. Book and register a patient in the browser.
2. Run the demo seeder from `backend/demo_seed`.
3. Create a patient with `/book`, then register face samples with `scripts/get_embedding.py`.

### Browser Test

1. Open `http://localhost:5173`.
2. Choose **Book Appointment**.
3. Fill the form.
4. Register a face using camera capture or upload.
5. Return to the main screen and choose **Check In**.
6. Use camera capture or image upload to verify.
7. Confirm the token appears.

### CLI Registration

After a patient exists:

```bash
cd backend
source venv/bin/activate
python scripts/get_embedding.py --patient_id PAT-001 --image ~/your-photo.jpg
```

Running registration again for the same patient appends another face sample. This is useful for straight, slightly-left, and slightly-right photos.

## Demo Data

Use the selected VGGFace2 folders in `backend/demo_seed/faces`, then run:

```text
backend/demo_seed/faces/
  Person_Name/
    forward.jpg
    left.jpg
    right.jpg
    remaining/
```

```bash
cd backend
source venv/bin/activate
python demo_seed/seed_from_faces.py
```

Useful commands:

```bash
python demo_seed/seed_from_faces.py --dry-run
python demo_seed/seed_from_faces.py --reset-all
python demo_seed/seed_from_faces.py --clear-seeded-only
python demo_seed/seed_from_faces.py --clear-all-only
```

## Core Features

### Patients

- Book appointments.
- Register one or more face samples.
- Check in with a live camera capture.
- Check in by uploading a saved image.
- Retrieve the digital token after a successful face match.

### Admins

- View all patients.
- See which patients are registered.
- Track tokens issued.
- Review check-in success rate and confidence statistics.
- Inspect failure reasons, risky matches, repeated failures, unregistered patients, check-ins over time, and department breakdowns.

### Backend

- Uses local InsightFace processing.
- Stores embeddings, not full uploaded images.
- Logs check-in attempts separately from patient records.
- Keeps JSON DB files out of git.

## API Examples

### Book Appointment

```bash
curl -X POST http://localhost:5050/book \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "doctor": "Dr. Smith",
    "department": "Cardiology",
    "appointment_time": "2026-07-20T10:00:00"
  }'
```

### Register Face Sample

```bash
curl -X POST http://localhost:5050/register \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "PAT-001",
    "image": "data:image/jpeg;base64,..."
  }'
```

### Verify Face

```bash
curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d '{"image": "data:image/jpeg;base64,..."}'
```

See `API.md` for the full reference.

## Troubleshooting

| Issue | Solution |
| --- | --- |
| Camera access denied | Allow camera in browser settings. Use HTTPS outside localhost. |
| No face detected | Use a clear, well-lit image with one visible face. |
| Face not recognised | Register the patient first or add more face samples. |
| Cannot reach server | Confirm `face_service.py` is running on port `5050`. |
| InsightFace model not found | First run needs internet and disk space for the model download. |

## Next Steps

1. Run the backend and frontend.
2. Seed demo data or book a test patient.
3. Register multiple face samples for that patient.
4. Try check-in with both camera capture and image upload.
5. Review the admin dashboard after a few successful and failed attempts.
