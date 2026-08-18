# MediPass Deployment Guide

MediPass is a local facial-recognition demo. The supplied Docker and systemd configurations are suitable for a controlled demonstration network, not for real patient data or an internet-facing production service.

## Local Docker Deployment

Prerequisites:

- Docker Engine 24+
- Docker Compose v2
- At least 4 GB RAM and roughly 1 GB free disk space
- Internet access on the first backend start so InsightFace can obtain its model

For a non-Docker frontend build, use Node.js 22.12 or newer; the container build uses Node.js 24.

From the repository root:

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

Open `http://localhost:5173`. The API is available at `http://localhost:5050`.

The compose file mounts these host directories so demo data survives container replacement:

- `backend/db` → `/app/db`
- `backend/uploads` → `/app/uploads`

The named `insightface-models` volume keeps the downloaded model cache between container replacements.

The app currently stores embeddings and JSON records, not captured image files. The uploads directory is reserved for future use.

Stop the demo with:

```bash
docker compose down
```

Avoid `docker compose down -v` unless you intentionally want to remove the downloaded InsightFace model volume. The demo JSON data uses bind mounts and is not removed by `docker compose down`.

## Configuration

Backend settings are process environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIMILARITY_THRESHOLD` | `0.45` | Cosine-similarity match threshold; must be between 0 and 1 |
| `REGISTRATION_SIMILARITY_THRESHOLD` | `0.20` | Minimum pairwise similarity within a three-image face set |
| `POSE_YAW_SIGN` | `-1` | Camera yaw calibration; set to `1` if left and right are reversed |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins |
| `FACE_MODEL` | `buffalo_l` | InsightFace model name |
| `INSIGHTFACE_HOME` | `~/.insightface` | Model cache directory |
| `DB_PATH` | `backend/db/patients.json` | Patient JSON path |
| `CHECKIN_ATTEMPTS_PATH` | beside `DB_PATH` | Check-in log JSON path |
| `MAX_REQUEST_BYTES` | `20971520` | Maximum HTTP request body |
| `MAX_IMAGE_BYTES` | `6291456` | Maximum decoded image size |

`backend/.env.example` is a reference file. The Python process does not automatically load it; export values in the shell, set them in systemd, or add them to the Compose service configuration.

Calibrate `POSE_YAW_SIGN` on the camera used for registration. Keep `-1` when the left and right prompts work correctly; switch to `1` when they are reversed. This setting belongs to the camera installation and is deliberately not fixed by the automated tests. If one backend serves devices with different camera orientations, give each device class a separately calibrated backend configuration or add per-device calibration before production use.

`VITE_API_URL` is compiled into the frontend bundle at build time. Rebuild the frontend image after changing it.

## Linux Demo Service

The included `backend/medipass-backend.service` assumes the repository is installed at `/opt/medipass` and runs as a `medipass` user.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin medipass
sudo mkdir -p /opt/medipass
sudo chown medipass:medipass /opt/medipass
```

After copying the project to `/opt/medipass`:

```bash
sudo -u medipass python3 -m venv /opt/medipass/backend/venv
sudo -u medipass /opt/medipass/backend/venv/bin/pip install -r /opt/medipass/backend/requirements.txt
sudo cp /opt/medipass/backend/medipass-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now medipass-backend
sudo systemctl status medipass-backend
```

The service binds to `127.0.0.1:5050`; put a TLS-enabled reverse proxy in front of it if access from another machine is required. Build the frontend with `npm ci && npm run build` and serve `frontend/dist` as static files.

## Health And Verification

```bash
curl http://127.0.0.1:5050/health
backend/venv/bin/python -m unittest discover -s backend/tests -v
cd frontend && npm run lint && npm run build
```

The backend container uses one Gunicorn worker with multiple threads. This is deliberate: the face model is large, and the local JSON storage is not safe for multiple processes or replicas.

## Before Any Real Deployment

Do not use real biometric or medical data until all of the following are designed, implemented, and independently reviewed:

- authenticated user sessions and role-based authorization, especially for `/patients`, `/checkin-attempts`, registration, and booking;
- HTTPS everywhere, secure headers, CSRF protections where applicable, and secrets kept out of the browser bundle;
- a transactional database with encryption, migrations, backups, retention/deletion workflows, and tested recovery;
- rate limits, abuse detection, audit trails, monitoring, and alerting;
- explicit consent and the privacy, residency, biometric-data, and healthcare compliance controls required in the deployment jurisdiction;
- a representative accuracy evaluation, threshold calibration, liveness/anti-spoofing controls, bias analysis, and a manual fallback path;
- documented incident response and a way to revoke or re-enrol compromised biometric templates.

An API key embedded in a Vite variable is not authentication: frontend build variables are visible to every browser user. Horizontal replicas must also not share these JSON files; migrate to a real database and coordinated vector index first.

## Backups For Demo Data

Stop the backend before taking a consistent file-level backup, then copy both JSON files together:

```bash
sudo systemctl stop medipass-backend
sudo cp /opt/medipass/backend/db/patients.json /secure-backup/patients.json
sudo cp /opt/medipass/backend/db/checkin_attempts.json /secure-backup/checkin_attempts.json
sudo systemctl start medipass-backend
```

Protect backups at least as strongly as the live data. Test restoration using a separate demo environment.
