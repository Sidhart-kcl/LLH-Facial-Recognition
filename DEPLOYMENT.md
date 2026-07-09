# MediPass Production Deployment Guide

This guide covers deploying MediPass to production environments with security, monitoring, and scalability considerations.

---

## Table of Contents

1. [Docker Deployment](#docker-deployment)
2. [Linux Server Deployment](#linux-server-deployment)
3. [Security Hardening](#security-hardening)
4. [SSL/HTTPS Setup](#ssl-https-setup)
5. [Reverse Proxy (Nginx)](#reverse-proxy-nginx)
6. [Monitoring & Logging](#monitoring-logging)
7. [Scaling](#scaling)

---

## Docker Deployment

### Prerequisites
- Docker 20.10+
- Docker Compose 1.29+
- 4GB RAM, 2 vCPU minimum

### Quick Start

```bash
# 1. Clone repo
git clone <repo> && cd <repo-directory>

# 2. Build and run
docker-compose up -d

# 3. Check status
docker-compose ps
docker-compose logs -f backend
docker-compose logs -f frontend
```

### Production Configuration

Create `.env.production` in root:

```env
FLASK_ENV=production
FLASK_DEBUG=False
SIMILARITY_THRESHOLD=0.47
CORS_ORIGINS=https://medipass.example.com
VITE_API_URL=https://medipass.example.com
LOG_LEVEL=WARNING
```

Edit `docker-compose.yml`:

```yaml
services:
  backend:
    environment:
      - FLASK_ENV=production
      - SIMILARITY_THRESHOLD=0.47
      - CORS_ORIGINS=https://medipass.example.com
    expose:  # Don't expose directly; use reverse proxy
      - 5050
    restart: always
    healthcheck:
      start_period: 60s  # Allow model download time

  frontend:
    build:
      args:
        VITE_API_URL: https://medipass.example.com/api
    expose:
      - 5173
    restart: always
```

### Persistent Data

Create volumes for backups:

```yaml
volumes:
  db-volume:
    driver: local
    driver_opts:
      type: nfs
      o: addr=192.168.1.100,vers=4,soft,timeo=180,bg,tcp,rw
      device: ":/export/medipass/db"

services:
  backend:
    volumes:
      - db-volume:/app/db
```

---

## Linux Server Deployment

### System Setup

```bash
# 1. Install dependencies
sudo apt-get update && apt-get install -y \
    python3.11 python3.11-venv python3-pip \
    nodejs npm \
    nginx \
    supervisor \
    curl wget

# 2. Create app user
sudo useradd -m -s /bin/bash medipass
sudo mkdir -p /opt/medipass
sudo chown medipass:medipass /opt/medipass

# 3. Clone repo
cd /opt/medipass
sudo -u medipass git clone <repo> .
```

### Backend Setup (Systemd)

```bash
# 1. Create virtual environment
sudo -u medipass python3.11 -m venv /opt/medipass/backend/venv
sudo -u medipass /opt/medipass/backend/venv/bin/pip install -r /opt/medipass/backend/requirements.txt

# 2. Copy service file
sudo cp /opt/medipass/backend/medipass-backend.service /etc/systemd/system/

# 3. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable medipass-backend
sudo systemctl start medipass-backend
sudo systemctl status medipass-backend

# 4. View logs
sudo journalctl -u medipass-backend -f
```

### Frontend Setup (Nginx)

```bash
# 1. Build React app
cd /opt/medipass/frontend
npm ci
npm run build

# 2. Configure Nginx (see next section)
```

---

## Security Hardening

### 1. API Authentication

Update `face_service.py`:

```python
from functools import wraps
import os

API_KEY = os.getenv("API_KEY", "change-me-in-production")

def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        key = request.headers.get("X-API-Key")
        if key != API_KEY:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.route("/verify", methods=["POST"])
@require_api_key
def verify_face():
    # ... existing code
```

Frontend usage with Vite:

```javascript
const res = await fetch(`${API}/verify`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": import.meta.env.VITE_API_KEY
  },
  body: JSON.stringify({ image: b64 })
});
```

### 2. Rate Limiting

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

@app.route("/verify", methods=["POST"])
@limiter.limit("10 per minute")  # 10 attempts per minute
def verify_face():
    # ...
```

### 3. Logging & Alerts

```python
import logging
from logging.handlers import RotatingFileHandler

handler = RotatingFileHandler(
    'logs/app.log',
    maxBytes=10485760,  # 10MB
    backupCount=10
)
app.logger.addHandler(handler)
app.logger.setLevel(logging.INFO)

# Log verification attempts
@app.before_request
def log_request():
    app.logger.info(f"{request.method} {request.path} - {request.remote_addr}")
```

### 4. Database Backup

```bash
# Daily backup script (cron)
#!/bin/bash
TIMESTAMP=$(date +%d%m%Y_%H%M%S)
cp /opt/medipass/backend/db/patients.json \
   /backup/medipass/patients_${TIMESTAMP}.json
cp /opt/medipass/backend/db/checkin_attempts.json \
   /backup/medipass/checkin_attempts_${TIMESTAMP}.json

# Encrypt sensitive backups
gpg --symmetric --cipher-algo AES256 \
    /backup/medipass/patients_${TIMESTAMP}.json
gpg --symmetric --cipher-algo AES256 \
    /backup/medipass/checkin_attempts_${TIMESTAMP}.json
```

---

## SSL/HTTPS Setup

### Generate Certificate (Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx

sudo certbot certonly --standalone \
  -d medipass.example.com \
  -d www.medipass.example.com \
  --email admin@example.com \
  --agree-tos

# Auto-renewal
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Manual Certificate (Self-Signed for Testing)

```bash
openssl req -x509 -newkey rsa:4096 \
  -keyout /etc/ssl/private/medipass.key \
  -out /etc/ssl/certs/medipass.crt \
  -days 365 -nodes
```

---

## Reverse Proxy (Nginx)

### Configuration

Create `/etc/nginx/sites-available/medipass`:

```nginx
upstream medipass_backend {
    server 127.0.0.1:5050;
}

upstream medipass_frontend {
    server 127.0.0.1:5173;
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name medipass.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl http2;
    server_name medipass.example.com;

    # SSL
    ssl_certificate /etc/ssl/certs/medipass.crt;
    ssl_certificate_key /etc/ssl/private/medipass.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Compression
    gzip on;
    gzip_types text/plain text/css text/javascript application/json;
    gzip_min_length 1000;

    # Frontend
    location / {
        proxy_pass http://medipass_frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api/ {
        proxy_pass http://medipass_backend/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # CORS headers
        add_header 'Access-Control-Allow-Origin' 'https://medipass.example.com' always;
        add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        add_header 'Access-Control-Allow-Headers' 'Content-Type, X-API-Key' always;

        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }

    # Cache assets
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/medipass /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Monitoring & Logging

### Prometheus + Grafana

Add metrics to Flask:

```python
from prometheus_client import Counter, Histogram, generate_latest

verify_requests = Counter('verify_requests_total', 'Total verify requests')
verify_latency = Histogram('verify_latency_seconds', 'Verify latency')

@app.route("/metrics")
def metrics():
    return generate_latest()

@app.route("/verify", methods=["POST"])
def verify_face():
    with verify_latency.time():
        verify_requests.inc()
        # ... rest of code
```

### ELK Stack (Elasticsearch, Logstash, Kibana)

Configure Filebeat to ship logs:

```yaml
# /etc/filebeat/filebeat.yml
filebeat.inputs:
- type: log
  enabled: true
  paths:
    - /opt/medipass/backend/logs/*.log

output.elasticsearch:
  hosts: ["elasticsearch.example.com:9200"]
  username: "elastic"
  password: "${ELASTIC_PASSWORD}"

processors:
  - add_kubernetes_metadata: ~
```

### Alerts

```python
import requests

def send_alert(message):
    """Send to Slack/PagerDuty"""
    requests.post(
        "https://hooks.slack.com/services/YOUR/WEBHOOK/URL",
        json={"text": f"🚨 MediPass Alert: {message}"}
    )

# High failure rate
if failed_verifications > 50:  # In last minute
    send_alert("Verification failure rate exceeded 50/min")
```

---

## Scaling

### Horizontal Scaling

```yaml
# docker-compose.prod.yml
services:
  backend:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure

  # Load balancer
  nginx:
    image: nginx:latest
    ports:
      - "5050:5050"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - backend
```

### Database Optimization

For 5000+ patients, use indexed search over the same seven comparison vectors used by `/verify`:

```python
from sklearn.neighbors import NearestNeighbors
import pickle

records = []
for patient in patients:
    for match_label, vector in patient_match_vectors(patient):
        records.append((patient, match_label, vector))

embeddings = np.array([vector for _, _, vector in records])
index = NearestNeighbors(n_neighbors=5, algorithm='kd_tree')
index.fit(embeddings)

# Save
with open("embeddings_index.pkl", "wb") as f:
    pickle.dump(index, f)

# At verification time
index = pickle.load(open("embeddings_index.pkl", "rb"))
distances, indices = index.kneighbors([face_embedding])
best_patient, best_label, best_vector = records[indices[0][0]]
```

---

## Maintenance

### Regular Tasks

```bash
# Weekly
- Review logs: `sudo journalctl -u medipass-backend --since "1 week ago"`
- Check disk space: `df -h`

# Monthly
- Update packages: `sudo apt-get update && upgrade`
- Rotate logs: `sudo logrotate -f /etc/logrotate.d/medipass`
- Backup database: See "Database Backup" section
```

### Health Checks

```bash
# Basic local check
curl http://localhost:5050/health

# Full system check through reverse proxy
curl https://medipass.example.com/api/health
```

---

## Rollback Procedure

```bash
# Keep last 3 images
docker image prune -a --filter "until=72h"

# Tag current as stable
docker tag medipass:latest medipass:stable-12-06-2026

# Rollback
docker-compose down
docker pull medipass:stable-12-06-2026
docker-compose up -d
```

---

## Support

Check logs:
```bash
docker-compose logs backend
sudo journalctl -u medipass-backend -n 100
```

Common issues → Main README.md
