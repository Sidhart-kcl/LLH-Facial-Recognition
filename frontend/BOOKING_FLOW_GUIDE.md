# Booking And Check-In Flow

This guide describes the current React + Flask flow in this project.

## Files Involved

```text
frontend/src/
├── App.jsx              # main navigation, check-in, camera/upload verification
├── BookingFlow.jsx      # booking form and face registration
├── AdminDashboard.jsx   # connected admin analytics dashboard
├── main.jsx
└── index.css

backend/
├── face_service.py      # Flask API
└── db/
    ├── patients.json
    └── checkin_attempts.json
```

`patients.json` and `checkin_attempts.json` are local-only files and are ignored by git.

## User Flow

### 1. Main Menu

The app starts with navigation for:

- Booking an appointment
- Checking in
- Opening the admin dashboard

### 2. Booking

The booking flow:

1. Collects patient name, doctor, department, and appointment time.
2. Captures or uploads a face image.
3. Calls `/book` to create the appointment.
4. Calls `/register` to store the first face embedding.
5. Shows the patient ID, appointment ID, and digital token.

### 3. Face Registration

`POST /register` appends a face embedding to the patient. It does not replace previous samples.

That means the same patient can have multiple samples, such as:

- Straight-on
- Slightly left
- Slightly right

A patient is treated as registered when they have at least one valid embedding. In admin API responses, this is exposed as:

```json
{
  "registered": true,
  "face_embedding_count": 3
}
```

### 4. Check-In

The check-in flow:

1. Shows a check-in start screen.
2. Lets the user start the face scan.
3. Offers **Capture** and **Upload** tabs.
4. Sends the selected image to `/verify`.
5. Shows the digital token if the face matches.

The backend compares the submitted face against each patient's angle-aware match set. For the standard three registration images, that means `forward`, `left`, `right`, the three pair averages, and the all-angle average. The best score from those vectors becomes that patient's score, and the best patient wins if the score is above `SIMILARITY_THRESHOLD`.

Every check-in attempt is logged to `backend/db/checkin_attempts.json`.

### 5. Admin Dashboard

The dashboard reads:

- `/patients`
- `/checkin-attempts`

It shows patient totals, registration coverage, token usage, check-in success rate, confidence averages, common failures, department breakdowns, risky matches, unregistered patients, and repeated failures.

## API Summary

### `POST /book`

Creates an appointment and patient record.

```json
{
  "name": "John Doe",
  "doctor": "Dr. Smith",
  "department": "Cardiology",
  "appointment_time": "2026-07-20T10:00:00"
}
```

### `POST /register`

Appends one face sample to an existing patient.

```json
{
  "patient_id": "PAT-001",
  "image": "data:image/jpeg;base64,..."
}
```

Success includes the total number of stored samples:

```json
{
  "success": true,
  "message": "Face registered for John Doe.",
  "embedding_count": 3
}
```

### `POST /verify`

Verifies a camera capture or uploaded image at check-in.

```json
{
  "image": "data:image/jpeg;base64,..."
}
```

Success:

```json
{
  "success": true,
  "confidence": 94.2,
  "token": "TKN-ABC12345",
  "patient": {
    "patient_id": "PAT-001",
    "name": "John Doe",
    "appointment_id": "APT-2026-0001",
    "appointment_time": "20 Jul 2026, 10:00 AM",
    "doctor": "Dr. Smith",
    "department": "Cardiology"
  }
}
```

### `GET /patients`

Returns patients without raw embeddings. `registered` is calculated from `face_embedding_count`.

### `GET /checkin-attempts`

Returns check-in logs for dashboard analytics.

## Local Storage Shape

Patient records use JSON, not PostgreSQL:

```json
{
  "patient_id": "PAT-001",
  "name": "John Doe",
  "appointment_id": "APT-2026-0001",
  "appointment_time": "2026-07-20T10:00:00",
  "doctor": "Dr. Smith",
  "department": "Cardiology",
  "digital_token": "TKN-ABC12345",
  "created_at": "2026-07-01T08:30:00.000000",
  "token_issued": false,
  "face_embeddings": [
    [0.123, -0.456],
    [0.234, -0.567]
  ],
  "registered": true,
  "registered_at": "2026-07-01T08:32:00.000000"
}
```

The real embedding arrays contain 512 numbers each.

## Testing Checklist

- [ ] Backend running with `python face_service.py`
- [ ] Frontend running with `npm run dev`
- [ ] Book a patient through the UI
- [ ] Register a face with camera capture
- [ ] Register another sample using upload or the CLI
- [ ] Check in with camera capture
- [ ] Check in with image upload
- [ ] Confirm attempts appear in the admin dashboard
- [ ] Confirm unregistered patients show in the dashboard when a patient has zero embeddings

## Troubleshooting

| Issue | Solution |
| --- | --- |
| Cannot reach server | Confirm the Flask backend is running on port `5050`. |
| Camera denied | Allow camera access in the browser. |
| No face detected | Use a clear image with one visible face. |
| Face not recognised | Add more face samples or tune `SIMILARITY_THRESHOLD`. |
| Dashboard is empty | Add patients through booking or run the demo seeder. |
