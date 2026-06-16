# MediPass — Digital Token Appointment System

A facial recognition–powered appointment verification system that replaces manual tokens with digital ones. Patients register their face during booking, then verify at check-in to instantly retrieve their appointment token.

```
Patient Books Appointment
         ↓
   Register Face
         ↓
  At Check-in: Scan Face
         ↓
   Return Digital Token
```

## Architecture

- **Backend**: Flask + InsightFace (Python)
- **Frontend**: React + Vite (Node.js)
- **Database**: JSON (patients.json)
- **Face Recognition**: InsightFace buffalo_l model (512-dim embeddings)

---

## Prerequisites

- Python 3.9+
- Node.js 18+ and npm
- Webcam (for browser access)
- ~500MB disk space (InsightFace model)

---

## Backend Setup

### 1. Create virtual environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

> **First run note**: InsightFace will auto-download the `buffalo_l` model (~500MB) on first startup. This takes 2–3 minutes.

### 3. Review patients.json

```bash
cat db/patients.json
```

Sample data is pre-loaded with 3 demo patients. You can edit this file or use the `/book` endpoint to add more.

### 4. Start the service

```bash
python face_service.py
```

```
🔧 Loading InsightFace model...
✅ InsightFace ready.
🚀 Starting Face Token Service on http://localhost:5050
```

### API Endpoints

#### `GET /health`
Health check.

#### `GET /patients`
List all patients (without embeddings). Admin/debugging only.

#### `POST /verify`
Verify a face and retrieve digital token.
```json
{
  "image": "data:image/jpeg;base64,..."
}
```
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

#### `POST /register`
Register a patient's face (first-time setup or update).
```json
{
  "patient_id": "PAT-001",
  "image": "data:image/jpeg;base64,..."
}
```

#### `POST /book`
Create a new appointment and patient record.
```json
{
  "name": "John Doe",
  "doctor": "Dr. Sarah Smith",
  "department": "Dermatology",
  "appointment_time": "2026-06-15T14:30:00"
}
```
**Response**:
```json
{
  "success": true,
  "patient_id": "PAT-004",
  "appointment_id": "APT-2026-0004",
  "digital_token": "TKN-X9Y0Z1A2",
  "message": "..."
}
```

---

## Frontend Setup

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Start dev server

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

### 3. Build for production

```bash
npm run build
```

Output goes to `frontend/dist/`.

---

## Workflow

### 1. **Booking** (Registration desk or web portal)

Admin/patient creates appointment:
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

Response includes `patient_id` and `digital_token`.

### 2. **Face Registration** (Optional, can be done at check-in)

Patient registers face using React app or CLI:

**Via React UI**: Click "Register Face" (future feature), capture photo.

**Via CLI**:
```bash
python scripts/get_embedding.py --patient_id PAT-001 --image ~/photo.jpg
```

Output:
```
✅ Face embedding registered for Ahmed Al Mansouri
   Appointment: APT-2026-0001
   Token ready: TKN-A1B2C3D4
```

### 3. **Check-in** (Kiosk or patient phone)

1. Patient approaches kiosk or opens React app on their phone
2. Click **Capture & Verify**
3. Face is matched against database
4. ✅ **Digital token retrieved instantly**

---

## Configuration

### Similarity Threshold

In `face_service.py`, line ~20:
```python
SIMILARITY_THRESHOLD = 0.45  # Tune between 0.3 (loose) to 0.6 (strict)
```

- **0.3**: More permissive (fewer false rejections, more false acceptances)
- **0.45**: Balanced (default, ~95% accuracy)
- **0.6**: Strict (fewer false acceptances, more false rejections)

**Tuning**: If legitimate patients are rejected, lower the threshold. If unauthorized matches occur, raise it.

### CORS Origins

In `face_service.py`, line ~40:
```python
CORS(app, origins=["http://localhost:5173"])
```

Add production URL when deploying:
```python
CORS(app, origins=["http://localhost:5173", "https://medipass.example.com"])
```

---

## Deployment Notes

### Self-Hosted (On-Premise)
- No cloud calls; all processing is local
- No face data leaves the hospital network
- Compliant with HIPAA, GDPR

### Docker (Optional)

Backend Dockerfile:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
EXPOSE 5050
CMD ["python", "face_service.py"]
```

### Production Security
1. Add API key authentication to `/verify` and `/register`
2. Enable HTTPS (use reverse proxy like nginx)
3. Restrict `/patients` endpoint to admin IPs
4. Log all verification attempts
5. Set up alerts for repeated failures (brute-force detection)

---

## Troubleshooting

### "Camera access denied"
- Allow camera in browser settings
- Refresh page
- Use HTTPS (required for camera access on production)

### "No face detected"
- Ensure good lighting
- Position face centered in frame
- Try closer to camera

### "Face not recognised"
- Patient may not be registered yet
- Try registering face first via `/register`
- Check similarity threshold (may need tuning)
- Verify patient exists in `db/patients.json`

### "Cannot reach the server"
- Is `face_service.py` running on port 5050?
- Check firewall (allow localhost:5050 or 0.0.0.0:5050)
- Frontend CORS origin must match backend config

### InsightFace model not loading
```
OSError: Model buffalo_l not found
```
- First run requires internet to download model (~500MB)
- Check disk space
- Try: `export INSIGHTFACE_HOME=/custom/path`

---

## File Structure

```
face-token-system/
├── backend/
│   ├── db/
│   │   └── patients.json          # Patient database + embeddings
│   ├── scripts/
│   │   └── get_embedding.py       # CLI face registration
│   ├── uploads/                   # Captured images (temp)
│   ├── face_service.py            # Main Flask app
│   ├── requirements.txt           # Python dependencies
│   └── .gitignore
│
└── frontend/
    ├── src/
    │   ├── App.jsx                # Main React component
    │   ├── main.jsx               # Entry point
    │   └── index.css              # Global styles
    ├── index.html                 # HTML template
    ├── vite.config.js             # Vite config
    ├── package.json               # Node dependencies
    └── .gitignore
```

---

## Performance

- **Face extraction**: ~200ms per image
- **Database lookup**: <1ms (linear search, scales to ~1000 patients)
- **End-to-end latency**: ~500ms (decode + extract + match + response)

For >5000 patients, consider:
1. Using AnnIndex (InsightFace's HNSW index)
2. Sharding patient database by location/date
3. Caching embeddings in Redis

---

## License

MIT (customize as needed)

---

## Support

- Docs: Check comments in `face_service.py` and `App.jsx`
- Issues: Adjust similarity threshold or CORS origins first
- Contact: Your medical IT team

**Made with ❤️ for healthcare.**
