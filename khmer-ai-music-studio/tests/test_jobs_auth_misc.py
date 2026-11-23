import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from conftest import make_settings, wait_job
from khmer_studio import publish
from khmer_studio.errors import Cancelled, StudioError
from khmer_studio.jobs import JobManager
from khmer_studio.main import create_app
from khmer_studio.storage import ProjectStore


@pytest.fixture()
def store(tmp_path):
    return ProjectStore(tmp_path / "projects")


def test_queue_position_cancel_queued_and_running(store):
    p = store.create("t")
    mgr = JobManager(store)
    mgr.start()
    gate = threading.Event()
    seen = {}

    def slow(ctx):
        ctx.progress(0.3, "generating", "កំពុងបង្កើត")
        gate.wait(5)
        return {"ok": 1}

    def never(ctx):  # pragma: no cover - must not run
        seen["ran"] = True
        return {}

    def cancellable(ctx):
        while not ctx.cancelled():
            time.sleep(0.02)
        raise Cancelled()

    a = mgr.submit(p["id"], "music", slow)
    b = mgr.submit(p["id"], "music", never)
    time.sleep(0.2)
    assert mgr.get(a["id"])["status"] == "running" and mgr.get(a["id"])["progress"] == 0.3
    assert mgr.get(b["id"])["status"] == "queued" and mgr.get(b["id"])["queue_position"] == 1
    assert mgr.cancel(b["id"])["status"] == "cancelled"
    gate.set()
    for _ in range(100):
        if mgr.get(a["id"])["status"] == "succeeded":
            break
        time.sleep(0.05)
    assert mgr.get(a["id"])["status"] == "succeeded" and mgr.get(a["id"])["result"] == {"ok": 1}
    assert "ran" not in seen and mgr.get(b["id"])["status"] == "cancelled"

    c = mgr.submit(p["id"], "music", cancellable)
    time.sleep(0.2)
    assert mgr.cancel(c["id"])["cancel_requested"] is True
    for _ in range(100):
        if mgr.get(c["id"])["status"] == "cancelled":
            break
        time.sleep(0.05)
    assert mgr.get(c["id"])["status"] == "cancelled"
    mgr.stop()


def test_error_is_stored_with_khmer_message_and_survives_restart(store):
    p = store.create("t")
    mgr = JobManager(store)
    mgr.start()

    def boom(ctx):
        raise StudioError("engine_failed", "ម៉ូដែលបរាជ័យ", detail="oom", hint="ព្យាយាមម្ដងទៀត")

    def crash(ctx):
        raise RuntimeError("bug")

    a = mgr.submit(p["id"], "music", boom)
    b = mgr.submit(p["id"], "music", crash)
    for _ in range(100):
        if all(mgr.get(x["id"])["status"] == "failed" for x in (a, b)):
            break
        time.sleep(0.05)
    ja, jb = mgr.get(a["id"]), mgr.get(b["id"])
    assert ja["error"] == {"code": "engine_failed", "message": "ម៉ូដែលបរាជ័យ", "detail": "oom", "hint": "ព្យាយាមម្ដងទៀត"}
    assert jb["error"]["code"] == "internal" and "RuntimeError" in jb["error"]["detail"]
    mgr.stop()

    # a "running" job left on disk by a crashed/closed app must come back as failed/interrupted, not stuck forever
    jobs_dir = store.project_dir(p["id"]) / "jobs"
    stale = {"id": "j_20200101_deadbeef", "project_id": p["id"], "kind": "music", "status": "running", "stage": "generating", "log": [], "params": {}}
    (jobs_dir / "j_20200101_deadbeef.json").write_text(json.dumps(stale), encoding="utf-8")
    mgr2 = JobManager(store)
    mgr2.start()
    recovered = mgr2.get("j_20200101_deadbeef")
    assert recovered["status"] == "failed" and recovered["error"]["code"] == "interrupted"
    assert mgr2.get(a["id"])["status"] == "failed"  # finished jobs are reloaded as they were
    mgr2.stop()


def test_auth_token_cookie_and_bearer(tmp_path):
    app = create_app(make_settings(tmp_path, token="s3cret"))
    with TestClient(app) as c:
        assert c.get("/api/projects").status_code == 401
        assert c.get("/api/auth").json() == {"required": True, "ok": False}
        assert c.post("/api/login", json={"token": "wrong"}).status_code == 401
        assert c.get("/", follow_redirects=False).status_code == 200  # the page itself must load so it can show the login box
        assert c.get("/api/projects", headers={"Authorization": "Bearer s3cret"}).status_code == 200
        ok = c.post("/api/login", json={"token": "s3cret"})
        assert ok.status_code == 200 and "kms_token=s3cret" in ok.headers["set-cookie"] and "HttpOnly" in ok.headers["set-cookie"]
        assert c.get("/api/projects").status_code == 200  # cookie now sent automatically (also used by <audio src>)
        assert c.get("/api/auth").json() == {"required": True, "ok": True}


def test_no_token_means_open(client):
    assert client.get("/api/auth").json() == {"required": False, "ok": True}
    assert client.get("/api/projects").status_code == 200


def test_health_lists_engines_and_is_honest(client):
    h = client.get("/api/health?refresh=1").json()
    ids = {e["id"]: e for e in h["engines"]}
    assert set(ids) >= {"acestep", "selftest"} and "heartmula" not in ids  # only offered when HEARTMULA_DIR is set
    assert ids["acestep"]["is_ai"] is True and ids["acestep"]["health"]["state"] == "unreachable"
    assert ids["selftest"]["is_ai"] is False and ids["selftest"]["khmer_status"] == "not_ai"
    assert ids["acestep"]["khmer_status"] == "not_documented"
    assert h["ffmpeg"]["ok"] and h["ffmpeg"]["has_ass"] and any(f.startswith("NotoSansKhmer") for f in h["fonts"])
    assert h["llm"]["configured"] is False


def test_presets_endpoint(client):
    p = client.get("/api/presets").json()
    assert {s["id"] for s in p["styles"]} >= {"kantrum", "ballad", "rap", "rock"}
    assert {i["id"] for i in p["instruments"]} >= {"khloy", "trosau", "guitar"}
    assert "chorus" in p["section_types"] and "Noto Sans Khmer" in p["fonts"]


def test_publish_with_ai_engine_credits_mention_model_and_license():
    project = {"title": "បទ", "artist": "សិល្បករ ខ្មែរ", "music": {"styles": ["ballad", "rap"]}, "lyrics": {"sections": [{"lines": ["ក", "ខ"]}]}}
    info = {"genre": "បាឡាដ", "ai_disclosure": True, "extra_tags": "hello,#world", "lyrics_by": "ខ្ញុំ"}
    out = publish.generate(project, info, {"name": "ACE-Step 1.5 (turbo)", "is_ai": True, "license": "MIT"})
    cred = out["youtube"]["credits"]
    assert "ACE-Step 1.5 (turbo)" in cred and "MIT" in cred and "ទំនុក: ខ្ញុំ" in cred
    tags = out["youtube"]["hashtags"].split()
    assert "#សិល្បករខ្មែរ" in tags and "#hello" in tags and "#world" in tags and "#AIMusic" in tags
    assert "#បាឡាដ" in tags and "#KhmerRap" in tags
    no_ai = publish.generate(project, {**info, "ai_disclosure": False}, {"name": "x", "is_ai": True})
    assert "🤖" not in no_ai["youtube"]["credits"] and "#AIMusic" not in no_ai["youtube"]["hashtags"]
