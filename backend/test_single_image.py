"""
Send one local image to the running /verify endpoint.

Usage:
  python test_single_image.py --image path/to/checkin.jpg
"""

from __future__ import annotations

import argparse
import base64
import json
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_BACKEND_URL = "http://localhost:5050/verify"


def encode_image(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def post_json(url: str, payload: dict) -> tuple[int, dict]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Test one check-in image against the backend.")
    parser.add_argument("--image", required=True, type=Path, help="Path to a local face image.")
    parser.add_argument("--url", default=DEFAULT_BACKEND_URL, help="Verify endpoint URL.")
    args = parser.parse_args()

    image_path = args.image.expanduser().resolve()
    if not image_path.exists():
        print(f"Image not found: {image_path}")
        return 1

    print(f"Testing image: {image_path}")
    print(f"Endpoint: {args.url}")

    try:
        status, result = post_json(args.url, {"image": encode_image(image_path)})
    except urllib.error.URLError:
        print("Cannot connect to backend. Is face_service.py running on http://localhost:5050?")
        return 1

    print(json.dumps(result, indent=2))
    return 0 if status < 500 else 1


if __name__ == "__main__":
    raise SystemExit(main())
