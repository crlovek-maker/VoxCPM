"""End-to-end API flow through the real FastAPI app, real FFmpeg and the (non-AI) selftest engine.

The selftest engine only proves the PIPELINE (jobs, versions, downloads, karaoke MP4...). It says
nothing about the AI model — that is covered by test_engine_acestep.py (protocol) and by running the
real model (see docs/TEST_REPORT.md).
"""
import io
import json
import subprocess
import wave
from pathlib import Path

import pytest
from PIL import Image

from conftest import KHMER_4_LINES, needs_ffmpeg, wait_job

pytestmark = needs_ffmpeg


def ffprobe_json(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def gen_chorus(client, pid, seconds=6):
    r = client.post(f"/api/projects/{pid}/generate", json={"mode": "chorus_test", "engine": "selftest", "music": {"chorus_duration": seconds}})
    assert r.status_code == 200, r.text
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "succeeded", job
    return job


def test_project_crud_and_persistence(client, project):
    pid = project["id"]
    assert client.get(f"/api/projects/{pid}").json()["title"] == "ស្រុកខ្មែរអើយ"
    assert any(p["id"] == pid for p in client.get("/api/projects").json()["projects"])
    patched = client.patch(f"/api/projects/{pid}", json={"title": "ចំណងជើងថ្មី", "music": {"bpm": 90, "styles": ["rock"], "bogus": 1}}).json()
    assert patched["title"] == "ចំណងជើងថ្មី" and patched["music"]["bpm"] == 90 and "bogus" not in patched["music"]
    assert client.get("/api/projects/p_00000000_00000000").status_code == 404
    assert client.get("/api/projects/..%2F..%2Fetc").status_code in (404, 422)
    assert client.delete(f"/api/projects/{pid}").status_code == 200
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_lyrics_put_undo_and_parse(client, project):
    pid = project["id"]
    sections = project["lyrics"]["sections"]
    assert sections[0]["type"] == "chorus" and sections[0]["lines"] == KHMER_4_LINES
    new = [{"id": sections[0]["id"], "type": "chorus", "lines": ["ឃ្លាថ្មី"]}]
    after = client.put(f"/api/projects/{pid}/lyrics", json={"sections": new, "history_label": "មុនកែ"}).json()
    assert after["lyrics"]["sections"][0]["lines"] == ["ឃ្លាថ្មី"] and len(after["lyrics_history"]) == 1
    undone = client.post(f"/api/projects/{pid}/lyrics/undo").json()
    assert undone["lyrics"]["sections"][0]["lines"] == KHMER_4_LINES
    assert client.post(f"/api/projects/{pid}/lyrics/undo").status_code == 409
    parsed = client.post("/api/lyrics/parse", json={"text": "[Verse]\na\n\n[Chorus]\nb"}).json()["sections"]
    assert [x["type"] for x in parsed] == ["verse", "chorus"]


def test_chorus_test_creates_separate_version_with_audio_and_downloads(client, project):
    pid = project["id"]
    job = gen_chorus(client, pid)
    assert job["result"]["version_id"] and job["progress"] == 1.0 and job["stage"] == "done"
    proj = client.get(f"/api/projects/{pid}").json()
    assert len(proj["versions"]) == 1
    v = proj["versions"][0]
    assert v["kind"] == "chorus_test" and v["engine"]["id"] == "selftest" and v["engine"]["is_ai"] is False
    assert v["lyrics_snapshot"][0]["lines"] == KHMER_4_LINES  # the version remembers exactly which lyrics it was made from
    assert proj["selected_version_id"] == v["id"]
    assert abs(v["duration"] - 6) < 0.3 and v["sample_rate"] == 44100

    # played in the browser: Range requests must work (iOS Safari refuses audio without them)
    url = f"/media/{pid}/audio/{v['id']}.wav"
    full = client.get(url)
    assert full.status_code == 200 and full.headers["accept-ranges"] == "bytes" and full.content[:4] == b"RIFF"
    part = client.get(url, headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100 and part.headers["content-range"].startswith("bytes 0-99/")

    wav = client.get(f"/api/projects/{pid}/versions/{v['id']}/download?format=wav")
    assert wav.status_code == 200 and "attachment" in wav.headers["content-disposition"] and wav.content[:4] == b"RIFF"
    mp3 = client.get(f"/api/projects/{pid}/versions/{v['id']}/download?format=mp3")
    assert mp3.status_code == 200 and mp3.headers["content-type"] == "audio/mpeg" and len(mp3.content) > 2000
    tmp = Path(client.app.state.settings.data_dir) / "dl.mp3"
    tmp.write_bytes(mp3.content)
    assert ffprobe_json(tmp)["streams"][0]["codec_name"] == "mp3"
    assert client.get(f"/api/projects/{pid}/versions/{v['id']}/download?format=ogg").status_code == 422


def test_failed_generation_is_reported_truthfully(client, project):
    """ACE-Step is not running (dead port): the job must FAIL visibly, never fake a result."""
    pid = project["id"]
    r = client.post(f"/api/projects/{pid}/generate", json={"mode": "chorus_test", "engine": "acestep"})
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "failed" and job["error"]["code"] == "engine_unreachable"
    assert "acestep-api" in job["error"]["hint"]
    assert client.get(f"/api/projects/{pid}").json()["versions"] == []
    # the failure is also persisted and listed for the project
    assert client.get(f"/api/projects/{pid}/jobs").json()["jobs"][0]["status"] == "failed"


def test_generate_validation(client):
    empty = client.post("/api/projects", json={"title": "ទទេ"}).json()
    r = client.post(f"/api/projects/{empty['id']}/generate", json={"mode": "full", "engine": "selftest"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    r = client.post(f"/api/projects/{empty['id']}/generate", json={"mode": "full", "engine": "nope", "instrumental": True})
    assert r.status_code == 422
    r = client.post(f"/api/projects/{empty['id']}/generate", json={"mode": "full", "engine": "selftest", "instrumental": True, "music": {"duration": 5}})
    assert r.status_code == 200  # instrumental needs no lyrics
    assert wait_job(client, r.json()["id"])["status"] == "succeeded"
    v = client.get(f"/api/projects/{empty['id']}").json()["versions"][0]
    assert v["instrumental"] is True and v["kind"] == "full" and "ភ្លេងសុទ្ធ" in v["label"]


def test_versions_rename_select_delete(client, project):
    pid = project["id"]
    gen_chorus(client, pid, 5)
    gen_chorus(client, pid, 5)
    versions = client.get(f"/api/projects/{pid}").json()["versions"]
    assert [v["label"].endswith(f"#{i + 1}") for i, v in enumerate(versions)] == [True, True]
    a, b = versions
    assert client.post(f"/api/projects/{pid}/select-version", json={"version_id": b["id"]}).json()["selected_version_id"] == b["id"]
    assert client.patch(f"/api/projects/{pid}/versions/{a['id']}", json={"label": "កំណែល្អ"}).json()["versions"][0]["label"] == "កំណែល្អ"
    after = client.delete(f"/api/projects/{pid}/versions/{b['id']}").json()
    assert [v["id"] for v in after["versions"]] == [a["id"]] and after["selected_version_id"] == a["id"]
    assert client.get(f"/media/{pid}/audio/{b['id']}.wav").status_code == 404


def test_media_path_traversal_is_blocked(client, project):
    pid = project["id"]
    assert client.get(f"/media/{pid}/audio/..%2Fproject.json").status_code == 404
    assert client.get(f"/media/{pid}/jobs/x.json").status_code == 404
    assert client.get(f"/media/{pid}/audio/..").status_code == 404


def test_karaoke_flow_validates_then_renders_real_mp4(client, project):
    pid = project["id"]
    gen_chorus(client, pid, 6)
    v = client.get(f"/api/projects/{pid}").json()["versions"][0]
    init = client.post(f"/api/projects/{pid}/karaoke/init", json={"version_id": v["id"]}).json()
    lines = init["karaoke"]["lines"]
    assert [x["text"] for x in lines] == KHMER_4_LINES and all(x["start"] is None for x in lines)

    r = client.post(f"/api/projects/{pid}/karaoke/render", json={"resolution": "1280x720"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "mv_missing_times"

    timed = [{**ln, "start": 0.5 + i * 1.2} for i, ln in enumerate(lines)]
    assert client.put(f"/api/projects/{pid}/karaoke", json={"version_id": v["id"], "lines": timed}).status_code == 200
    frame = client.post(f"/api/projects/{pid}/karaoke/frame", json={"resolution": "1920x1080", "at": 2.0})
    assert frame.status_code == 200 and frame.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert Image.open(io.BytesIO(frame.content)).size == (1920, 1080)

    for res, size in (("1280x720", (1280, 720)), ("1080x1920", (1080, 1920))):
        r = client.post(f"/api/projects/{pid}/karaoke/render", json={"resolution": res})
        assert r.status_code == 200, r.text
        job = wait_job(client, r.json()["id"], timeout=120)
        assert job["status"] == "succeeded", job
        mv = job["result"]
        path = client.app.state.store.project_dir(pid) / "mv" / f"{mv['mv_id']}.mp4"
        info = ffprobe_json(path)
        vs = next(s for s in info["streams"] if s["codec_type"] == "video")
        au = next(s for s in info["streams"] if s["codec_type"] == "audio")
        assert (vs["width"], vs["height"]) == size and vs["codec_name"] == "h264" and vs["pix_fmt"] == "yuv420p"
        assert au["codec_name"] == "aac"
        assert abs(float(info["format"]["duration"]) - v["duration"]) < 0.5  # video length == song length
        dl = client.get(f"/api/projects/{pid}/mv/{mv['mv_id']}/download")
        assert dl.status_code == 200 and dl.headers["content-type"] == "video/mp4" and dl.content[4:8] == b"ftyp"
    outs = client.get(f"/api/projects/{pid}").json()["karaoke"]["outputs"]
    assert [o["resolution"] for o in outs] == ["1280x720", "1080x1920"]


def test_cover_upload_and_mv_background(client, project):
    pid = project["id"]

    def png(color, size=(640, 360)):
        b = io.BytesIO()
        Image.new("RGB", size, color).save(b, "PNG")
        return b.getvalue()

    r = client.post(
        f"/api/projects/{pid}/cover",
        files={"final": ("c.png", png("red"), "image/png"), "plain": ("p.png", png("blue"), "image/png")},
        data={"aspect": "16:9", "title": "ស្រុកខ្មែរអើយ", "has_text": "1", "mv_use": "plain", "editor": json.dumps({"zoom": 1.2})},
    )
    assert r.status_code == 200, r.text
    cover = r.json()["cover"]
    entry = cover["files"]["16:9"]
    assert entry["title"] == "ស្រុកខ្មែរអើយ" and entry["plain"] and cover["mv_background"] == entry["plain"] and cover["editor"]["16:9"]["zoom"] == 1.2
    got = client.get(f"/media/{pid}/covers/{entry['file']}")
    assert got.status_code == 200 and got.content[:4] == b"\x89PNG"
    dl = client.get(f"/media/{pid}/covers/{entry['file']}?dl=1&as_name=cover.png")
    assert "attachment" in dl.headers["content-disposition"]
    bad = client.post(f"/api/projects/{pid}/cover", files={"final": ("x.png", b"not an image", "image/png")}, data={"aspect": "16:9"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_image"
    assert client.post(f"/api/projects/{pid}/cover", files={"final": ("c.png", png("red"), "image/png")}, data={"aspect": "4:3"}).status_code == 422
    src = client.post(f"/api/projects/{pid}/cover/source", files={"image": ("s.png", png("green", (2000, 1000)), "image/png")}).json()
    assert src["file"].startswith("source_") and client.get(src["url"]).status_code == 200
    gone = client.delete(f"/api/projects/{pid}/cover/16x9").json()["cover"]
    assert "16:9" not in gone["files"] and gone["mv_background"] is None


def wav_bytes(seconds=3.0, rate=44100, freq=330):
    import math
    import struct

    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(int(seconds * rate))))
    return b.getvalue()


def test_own_voice_mixed_with_generated_instrumental(client, project):
    pid = project["id"]
    r = client.post(f"/api/projects/{pid}/generate", json={"mode": "full", "engine": "selftest", "instrumental": True, "music": {"duration": 8}})
    assert wait_job(client, r.json()["id"])["status"] == "succeeded"
    inst = client.get(f"/api/projects/{pid}").json()["versions"][0]
    assert inst["instrumental"] is True
    voice = client.post(f"/api/projects/{pid}/voice", files={"file": ("my voice.wav", wav_bytes(3), "audio/wav")}, data={"label": "ថតលើកទី១"})
    assert voice.status_code == 200, voice.text
    vj = voice.json()
    assert vj["label"] == "ថតលើកទី១" and abs(vj["duration"] - 3) < 0.2
    body = {"instrumental_version_id": inst["id"], "voice_id": vj["id"], "music_db": -6, "voice_db": 3, "voice_offset": 0.5, "seconds": 4}
    prev = client.post(f"/api/projects/{pid}/mix/preview", json=body)
    assert prev.status_code == 200
    audio = client.get(prev.json()["url"])
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
    r = client.post(f"/api/projects/{pid}/mix", json={**body, "label": "ជាមួយសំឡេងខ្ញុំ"})
    job = wait_job(client, r.json()["id"])
    assert job["status"] == "succeeded", job
    proj = client.get(f"/api/projects/{pid}").json()
    mix = next(v for v in proj["versions"] if v["kind"] == "mix")
    assert mix["source"]["voice_id"] == vj["id"] and mix["source"]["music_db"] == -6 and abs(mix["duration"] - inst["duration"]) < 0.3
    assert proj["selected_version_id"] == mix["id"]
    assert mix["lyrics_snapshot"][0]["lines"] == KHMER_4_LINES  # mix keeps the lyrics for karaoke
    assert client.delete(f"/api/projects/{pid}/voice/{vj['id']}").json()["voice_recordings"] == []
    assert client.post(f"/api/projects/{pid}/voice", files={"file": ("x.wav", b"garbage", "audio/wav")}).status_code == 422


def test_upload_existing_audio_as_version(client, project):
    pid = project["id"]
    r = client.post(f"/api/projects/{pid}/versions/upload", files={"file": ("mine.wav", wav_bytes(2), "audio/wav")}, data={"label": "ឯកសារខ្ញុំ"})
    assert r.status_code == 200
    v = r.json()["versions"][0]
    assert v["kind"] == "upload" and v["label"] == "ឯកសារខ្ញុំ" and v["engine"]["is_ai"] is False


def test_publish_generate_edit_and_ai_disclosure(client, project):
    pid = project["id"]
    gen_chorus(client, pid, 5)
    out = client.post(f"/api/projects/{pid}/publish/generate", json={"info": {"genre": "បាឡាដ", "mood": "ស្រទន់", "links": "https://example.com"}}).json()
    yt, fb, tt = out["texts"]["youtube"], out["texts"]["facebook"], out["texts"]["tiktok"]
    assert "ស្រុកខ្មែរអើយ" in yt["title"] and "សាកល្បង" in yt["title"]
    assert KHMER_4_LINES[0] in yt["description"] and "Credits" in yt["description"] and "https://example.com" in yt["description"]
    assert "#ចម្រៀងខ្មែរ" in yt["hashtags"] and len(yt["hashtags"].split()) <= 12
    assert len(tt["hashtags"].split()) <= 5 and len(fb["hashtags"].split()) <= 8
    assert "🤖" not in yt["credits"]  # the selected version came from the NON-AI selftest engine: do not claim AI
    saved = client.put(f"/api/projects/{pid}/publish", json={"texts": {"youtube": {"description": "កែហើយ"}, "bogus": {"x": "y"}}}).json()
    assert saved["publish"]["texts"]["youtube"]["description"] == "កែហើយ" and "bogus" not in saved["publish"]["texts"]
    assert saved["publish"]["texts"]["youtube"]["title"] == yt["title"]  # untouched fields are kept


def test_english_lyrics_set_language_en_and_khmer_stays_unknown(tmp_path):
    """English works too: no Khmer letters -> `vocal_language=en` is sent; Khmer lyrics keep `unknown` (km is not a listed language)."""
    from fastapi.testclient import TestClient

    from conftest import make_settings
    from fake_acestep import FakeAceStep
    from khmer_studio.main import create_app

    with FakeAceStep() as fake:
        app = create_app(make_settings(tmp_path, acestep_url=fake.url, default_engine="acestep"))
        with TestClient(app) as c:
            en = c.post("/api/projects", json={"title": "Song", "artist": "Me", "lyrics_text": "[Verse]\nWalking down the road tonight\nStars are shining bright"}).json()
            job = wait_job(c, c.post(f"/api/projects/{en['id']}/generate", json={"mode": "chorus_test", "engine": "acestep"}).json()["id"], 60)
            assert job["status"] == "succeeded", job
            v = c.get(f"/api/projects/{en['id']}").json()["versions"][0]
            assert fake.payloads[0]["vocal_language"] == "en" and fake.payloads[0]["lyrics"].startswith("[Verse 1]\nWalking down")
            assert any("en" in n for n in v["notes"]) and v["vocal_language_sent"] == "en"

            km = c.post("/api/projects", json={"title": "ខ្មែរ", "lyrics_text": "[Chorus]\n" + "\n".join(KHMER_4_LINES)}).json()
            job = wait_job(c, c.post(f"/api/projects/{km['id']}/generate", json={"mode": "chorus_test", "engine": "acestep"}).json()["id"], 60)
            assert job["status"] == "succeeded", job
            assert fake.payloads[1]["vocal_language"] == "unknown"
            # an explicit choice is never overridden
            c.patch(f"/api/projects/{en['id']}", json={"music": {"vocal_language": "fr"}})
            wait_job(c, c.post(f"/api/projects/{en['id']}/generate", json={"mode": "chorus_test", "engine": "acestep"}).json()["id"], 60)
            assert fake.payloads[2]["vocal_language"] == "fr"
