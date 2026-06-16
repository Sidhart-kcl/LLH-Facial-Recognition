import json
import base64
import requests
from pathlib import Path

# Configuration
BACKEND_URL = "http://localhost:5050/verify"
UPLOADS_DIR = Path("../uploads")  # Relative to backend folder
TEST_IMAGE = "P1001.jpg"

# Read image and convert to base64
image_path = UPLOADS_DIR / TEST_IMAGE

if not image_path.exists():
    print(f"❌ Image not found: {image_path}")
    print(f"   Looking in: {UPLOADS_DIR.resolve()}")
    exit(1)

print(f"📸 Testing with: {TEST_IMAGE}")
print(f"📁 Path: {image_path.resolve()}\n")

# Convert to base64
with open(image_path, "rb") as f:
    image_b64 = base64.b64encode(f.read()).decode()

# Send to backend
print("🔄 Sending to backend...\n")
try:
    response = requests.post(
        BACKEND_URL,
        json={"image": image_b64},
        timeout=10
    )
    
    result = response.json()
    
    # Pretty print result
    print("=" * 70)
    if result.get("success"):
        print("✅ MATCH FOUND!")
        print(f"\n   Patient ID: {result['patient']['patient_id']}")
        print(f"   Name: {result['patient']['name']}")
        print(f"   Confidence: {result['confidence']}%")
        print(f"   Token: {result['patient']['appointment_id']}")
        print(f"   Doctor: {result['patient']['doctor']}")
        print(f"   Department: {result['patient']['department']}")
    else:
        print("❌ NO MATCH")
        print(f"\n   Error: {result.get('error')}")
        print(f"   Confidence: {result.get('confidence')}%")
    print("=" * 70)
    
except requests.exceptions.ConnectionError:
    print("❌ Cannot connect to backend!")
    print("   Is face_service.py running on http://localhost:5050?")
except Exception as e:
    print(f"❌ Error: {e}")