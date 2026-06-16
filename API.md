# MediPass API Reference

Base URL: `http://localhost:5050` (or `https://medipass.example.com/api`)

All endpoints return JSON. Timestamps are ISO 8601.

---

## Health Check

### `GET /health`

Server health and status.

```bash
curl http://localhost:5050/health
```

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-06-12T14:30:45.123456"
}
```

---

## Patient Management

### `GET /patients`

List all patients (admin view). **Note**: Excludes face embeddings for privacy.

```bash
curl http://localhost:5050/patients
```

**Response**:
```json
{
  "patients": [
    {
      "patient_id": "PAT-001",
      "name": "Ahmed Al Mansouri",
      "appointment_id": "APT-2026-0001",
      "appointment_time": "2026-06-12T09:00:00",
      "doctor": "Dr. Sara Hassan",
      "department": "Cardiology",
      "digital_token": "TKN-A1B2C3D4",
      "token_issued": false,
      "registered": false
    }
  ]
}
```

---

## Verification & Tokens

### `POST /verify`

Verify a face and retrieve the digital token. Core endpoint for check-in kiosks.

**Request**:
```bash
curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
  }'
```

**Fields**:
- `image` (required): Base64-encoded JPEG image. Can include `data:image/jpeg;base64,` prefix or raw base64.

**Response** (success):
```json
{
  "success": true,
  "confidence": 94.2,
  "token": "TKN-A1B2C3D4",
  "patient": {
    "name": "Ahmed Al Mansouri",
    "patient_id": "PAT-001",
    "appointment_id": "APT-2026-0001",
    "appointment_time": "12 Jun 2026, 09:00 AM",
    "doctor": "Dr. Sara Hassan",
    "department": "Cardiology"
  }
}
```

**Response** (failure):
```json
{
  "success": false,
  "error": "Face not recognised. Please ensure you are registered or speak to reception.",
  "confidence": 32.1
}
```

**Status Codes**:
- `200`: Match found, token returned
- `404`: No match (face not in database or below threshold)
- `422`: Image invalid or no face detected
- `400`: Missing `image` field

---

### `POST /register`

Register (or update) a patient's face embedding. Used for first-time enrollment or re-registration.

**Request**:
```bash
curl -X POST http://localhost:5050/register \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "PAT-001",
    "image": "data:image/jpeg;base64,..."
  }'
```

**Fields**:
- `patient_id` (required): Patient ID (e.g., "PAT-001")
- `image` (required): Base64-encoded JPEG image

**Response** (success):
```json
{
  "success": true,
  "message": "Face registered for Ahmed Al Mansouri."
}
```

**Response** (failure):
```json
{
  "success": false,
  "error": "Patient PAT-999 not found."
}
```

**Status Codes**:
- `200`: Face registered successfully
- `404`: Patient ID not found
- `422`: Image invalid or no face detected
- `400`: Missing fields

---

## Appointment Management

### `POST /book`

Create a new appointment and patient record. Returns `patient_id` and initial `digital_token`.

**Request**:
```bash
curl -X POST http://localhost:5050/book \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Layla Al Mazrouei",
    "doctor": "Dr. Hana Nasser",
    "department": "Pediatrics",
    "appointment_time": "2026-06-12T15:00:00"
  }'
```

**Fields**:
- `name` (required): Patient full name
- `doctor` (required): Attending physician
- `department` (required): Medical department/specialty
- `appointment_time` (required): ISO 8601 datetime (e.g., "2026-06-12T15:00:00")

**Response** (success):
```json
{
  "success": true,
  "patient_id": "PAT-004",
  "appointment_id": "APT-2026-0004",
  "digital_token": "TKN-X9Y0Z1A2",
  "message": "Appointment booked. Please register your face to activate your digital token."
}
```

**Response** (failure):
```json
{
  "success": false,
  "error": "Missing fields: [\"department\"]"
}
```

**Status Codes**:
- `200`: Appointment created
- `400`: Missing or invalid fields

---

## Common Workflows

### Workflow 1: Complete Patient Flow

```javascript
// Step 1: Book appointment
const bookRes = await fetch('http://localhost:5050/book', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'John Doe',
    doctor: 'Dr. Smith',
    department: 'Cardiology',
    appointment_time: new Date(Date.now() + 86400000).toISOString()
  })
});
const bookData = await bookRes.json();
const patientId = bookData.patient_id;

// Step 2: Patient registers face (with camera)
const faceImage = await captureFromCamera();
const registerRes = await fetch('http://localhost:5050/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    patient_id: patientId,
    image: faceImage
  })
});

// Step 3: At check-in, verify face
const verifyRes = await fetch('http://localhost:5050/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    image: faceImage // New capture or same image
  })
});
const verifyData = await verifyRes.json();
console.log('Token:', verifyData.token);
```

### Workflow 2: Pre-registered Patients

```bash
# Admin pre-registers patient at desk
curl -X POST http://localhost:5050/register \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "PAT-001",
    "image": "data:image/jpeg;base64,..."
  }'

# Patient arrives at kiosk
curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d '{"image": "data:image/jpeg;base64,..."}'
# → Returns token immediately
```

---

## Error Codes & Messages

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | `"No image provided."` | Missing `image` field in request body |
| 400 | `"Missing fields: [...]"` | Required fields missing in booking request |
| 404 | `"Patient PAT-999 not found."` | Patient ID doesn't exist |
| 404 | `"Face not recognised."` | Face matched but confidence below threshold (45%) |
| 422 | `"No face detected."` | Image is valid JPEG but no face found |
| 422 | `"Could not decode image."` | Base64 string is corrupted or invalid |

---

## Response Fields

### Patient Object
```json
{
  "patient_id": "PAT-001",
  "name": "Ahmed Al Mansouri",
  "appointment_id": "APT-2026-0001",
  "appointment_time": "2026-06-12T09:00:00",
  "doctor": "Dr. Sara Hassan",
  "department": "Cardiology",
  "digital_token": "TKN-A1B2C3D4",
  "token_issued": false,
  "registered": false,
  "face_embedding": null,  // Only in GET /patients if registered=true
  "registered_at": "2026-06-12T08:30:00",  // ISO timestamp
  "token_issued_at": "2026-06-12T09:15:00"  // ISO timestamp
}
```

### Confidence Score
- `0-30%`: Very low match, almost certainly wrong person
- `30-60%`: Uncertain, potential false positive
- `60-80%`: Good match, likely correct
- `80-100%`: Excellent match, almost certainly correct

Default threshold is **45%** (can be adjusted in backend config).

---

## Testing with cURL

### Test face verification (requires valid JPEG)
```bash
# Convert JPEG to base64
BASE64_IMG=$(base64 -i /path/to/photo.jpg)

# Send to verify endpoint
curl -X POST http://localhost:5050/verify \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$BASE64_IMG\"}"
```

### Test booking
```bash
curl -X POST http://localhost:5050/book \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Patient",
    "doctor": "Dr. Test",
    "department": "Testing",
    "appointment_time": "2026-06-20T10:00:00"
  }' | jq .
```

---

## Rate Limiting (Production)

- **Verify endpoint**: 10 requests/minute per IP
- **Register endpoint**: 5 requests/minute per IP
- **Book endpoint**: 20 requests/hour per IP

Exceeding limits returns `429 Too Many Requests`.

---

## CORS Headers

Requests must include:
```
Origin: http://localhost:5173 (dev) or https://medipass.example.com (prod)
```

Server responds with:
```
Access-Control-Allow-Origin: <matching origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, X-API-Key
```

---

## API Versioning

Current API version: `v1` (implicit)

No version prefix in URLs. Backward compatibility is maintained. Breaking changes will increment to `v2` in future.

---

## Webhooks (Future)

Reserved for future use:
```
POST /webhooks/token-issued
POST /webhooks/verification-failed
POST /webhooks/patient-registered
```

---

## Authentication (Production)

Include API key in headers:
```bash
curl -H "X-API-Key: your-secret-key" \
  http://localhost:5050/verify
```

Get key from environment variable `$API_KEY`.
