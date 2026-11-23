from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("STUDIO_SELFTEST_DELAY", "0.05")

from fastapi.testclient import TestClient  # noqa: E402

from khmer_studio.config import Settings  # noqa: E402
from khmer_studio.main import create_app  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="ffmpeg/ffprobe not installed")

KHMER_4_LINES = [
    "ខ្ញុំស្រឡាញ់ស្រុកខ្មែរ ដូចបេះដូងខ្ញុំ",
    "ទឹកដីដូនតា ភ្លឺថ្លាគ្រប់ពេល",
    "ចម្រៀងនេះសូមឮ ក្នុងចិត្តជានិច្ច",
    "ស្រុកខ្មែរអើយ ខ្ញុំនៅទីនេះ",
]


def make_settings(tmp_path: Path, **overrides) -> Settings:
    s = Settings()
    s.data_dir = tmp_path / "data"
    s.default_engine = "selftest"
    s.acestep_url = "http://127.0.0.1:9"  # nothing listens here: used to test the "model not reachable" path
    s.acestep_poll_seconds = 0.05
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


@pytest.fixture()
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def wait_job(client: TestClient, job_id: str, timeout: float = 90.0) -> dict:
    deadline = time.time() + timeout
    job = {}
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job did not finish in {timeout}s: {job}")


@pytest.fixture()
def project(client):
    r = client.post("/api/projects", json={"title": "ស្រុកខ្មែរអើយ", "artist": "សាកល្បង", "lyrics_text": "[Chorus]\n" + "\n".join(KHMER_4_LINES)})
    assert r.status_code == 200, r.text
    return r.json()
