"""Silence analysis. Regression: a REAL ACE-Step result ended 5 s early, but trailing_silence was reported as 0
because FFmpeg prints `silence_end` at end-of-file for a silent tail."""
import math
import struct
import wave
from pathlib import Path

import pytest

from conftest import KHMER_4_LINES, needs_ffmpeg, wait_job
from khmer_studio import audio as audio_tools

pytestmark = needs_ffmpeg


def write_wav(path: Path, parts, rate=44100):
    """parts: [(seconds, 'tone'|'silence'), ...]"""
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        for seconds, kind in parts:
            n = int(seconds * rate)
            if kind == "tone":
                w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * 330 * i / rate))) for i in range(n)))
            else:
                w.writeframes(b"\x00\x00" * n)
    return path


def test_leading_and_trailing_silence_are_measured(tmp_path):
    f = write_wav(tmp_path / "a.wav", [(1.0, "silence"), (2.0, "tone"), (3.0, "silence")])
    r = audio_tools.analyze("ffmpeg", f, 6.0)
    assert abs(r["leading_silence"] - 1.0) < 0.15
    assert abs(r["trailing_silence"] - 3.0) < 0.15
    assert abs(r["silent_seconds"] - 4.0) < 0.3


def test_middle_gap_is_not_counted_as_leading_or_trailing(tmp_path):
    f = write_wav(tmp_path / "b.wav", [(1.0, "tone"), (1.5, "silence"), (1.0, "tone")])
    r = audio_tools.analyze("ffmpeg", f, 3.5)
    assert r["leading_silence"] == 0 and r["trailing_silence"] == 0
    assert abs(r["silent_seconds"] - 1.5) < 0.2


def test_all_silent_file_is_detected(tmp_path):
    f = write_wav(tmp_path / "c.wav", [(3.0, "silence")])
    r = audio_tools.analyze("ffmpeg", f, 3.0)
    assert r["mean_db"] is not None and r["mean_db"] < -60
    assert abs(r["trailing_silence"] - 3.0) < 0.2 and abs(r["leading_silence"] - 3.0) < 0.2


def test_no_silence(tmp_path):
    f = write_wav(tmp_path / "d.wav", [(2.0, "tone")])
    r = audio_tools.analyze("ffmpeg", f, 2.0)
    assert r["leading_silence"] == 0 and r["trailing_silence"] == 0 and r["silent_seconds"] == 0


def _upload(client, pid, path: Path):
    r = client.post(f"/api/projects/{pid}/versions/upload", files={"file": (path.name, path.read_bytes(), "audio/wav")}, data={"label": "ចុងស្ងាត់"})
    assert r.status_code == 200, r.text
    return r.json()["versions"][-1]


def test_mv_trims_silent_tail_unless_disabled(client, project, tmp_path):
    pid = project["id"]
    v = _upload(client, pid, write_wav(tmp_path / "tail.wav", [(3.0, "tone"), (6.0, "silence")]))
    assert any("ចុងបទស្ងាត់" in w for w in v["warnings"])  # the user is told why the end looks empty
    lines = client.post(f"/api/projects/{pid}/karaoke/init", json={"version_id": v["id"]}).json()["karaoke"]["lines"]
    assert [x["text"] for x in lines] == KHMER_4_LINES
    timed = [{**ln, "start": 0.2 + i * 0.6} for i, ln in enumerate(lines)]  # last line starts at 2.0 s
    assert client.put(f"/api/projects/{pid}/karaoke", json={"version_id": v["id"], "lines": timed}).status_code == 200

    def render(style):
        job = wait_job(client, client.post(f"/api/projects/{pid}/karaoke/render", json={"resolution": "1280x720", "style": style}).json()["id"], 120)
        assert job["status"] == "succeeded", job
        path = client.app.state.store.project_dir(pid) / "mv" / f"{job['result']['mv_id']}.mp4"
        return audio_tools.probe("ffprobe", path)["duration"]

    trimmed = render({})
    full = render({"trim_silence": False})
    assert abs(full - 9.0) < 0.4
    assert 4.5 <= trimmed <= 5.6 and trimmed < full - 3  # tone ends at 3 s: video ends ~1.5 s later (never before last line + 3 s)
