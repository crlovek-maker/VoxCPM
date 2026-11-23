"""Adapter tests against a FAKE server that copies the real API's shapes (see fake_acestep.py)."""
from pathlib import Path

import pytest

from conftest import KHMER_4_LINES, make_settings
from fake_acestep import FakeAceStep
from khmer_studio.engines.acestep import CAPTION_LIMIT, AceStepEngine
from khmer_studio.engines.base import EngineContext, GenerationRequest
from khmer_studio.errors import Cancelled, EngineUnavailable, StudioError
from khmer_studio.lyrics import build_engine_lyrics, new_section


def engine_for(tmp_path, url):
    return AceStepEngine(make_settings(tmp_path, acestep_url=url))


def ctx_for(tmp_path, events=None, cancel=lambda: False):
    events = events if events is not None else []
    return EngineContext(tmp_path / "work", progress_cb=lambda f, st, m: events.append((st, f)), log_cb=lambda t: None, cancel_check=cancel), events


def khmer_request(**kw):
    base = dict(
        lyrics=build_engine_lyrics([new_section("chorus", KHMER_4_LINES)]),
        caption="Khmer pop ballad, flute",
        vocal_language="unknown",
        duration=30,
        seed=42,
        purpose="chorus_test",
    )
    base.update(kw)
    return GenerationRequest(**base)


def test_success_sends_khmer_lyrics_unchanged_and_reports_real_progress(tmp_path):
    with FakeAceStep() as fake:
        eng = engine_for(tmp_path, fake.url)
        ctx, events = ctx_for(tmp_path)
        res = eng.generate(khmer_request(), ctx)
        payload = fake.payloads[0]
    assert payload["lyrics"].startswith("[Chorus]\n" + KHMER_4_LINES[0])  # Khmer reaches the model byte for byte
    assert "\n".join(KHMER_4_LINES) in payload["lyrics"]
    assert payload["vocal_language"] == "unknown"
    assert payload["audio_format"] == "wav" and payload["batch_size"] == 1
    assert payload["thinking"] is False and payload["use_cot_language"] is False
    assert payload["use_random_seed"] is False and payload["seed"] == 42
    assert payload["audio_duration"] == 30.0
    assert "guidance_scale" not in payload  # turbo ignores CFG
    stages = [s for s, _ in events]
    for stage in ("engine_check", "submitting", "generating", "decoding", "encoding", "downloading"):
        assert stage in stages
    assert stages.index("generating") < stages.index("decoding") < stages.index("encoding") < stages.index("downloading")
    assert any(f == 0.6 for s, f in events if s == "generating")  # the server's own progress value is passed through
    assert res.path.is_file() and res.path.stat().st_size > 1000
    assert res.seed == 42 and res.engine_meta["dit_model"] == "acestep-v15-turbo"


def test_instrumental_uses_marker(tmp_path):
    with FakeAceStep() as fake:
        engine_for(tmp_path, fake.url).generate(khmer_request(instrumental=True), ctx_for(tmp_path)[0])
        assert fake.payloads[0]["lyrics"] == "[Instrumental]"


def test_caption_is_truncated_to_documented_limit_with_note(tmp_path):
    with FakeAceStep() as fake:
        res = engine_for(tmp_path, fake.url).generate(khmer_request(caption=", ".join(f"tag{i}" for i in range(300))), ctx_for(tmp_path)[0])
        assert len(fake.payloads[0]["prompt"]) <= CAPTION_LIMIT
    assert any("512" in n for n in res.notes)


def test_unlisted_language_gets_a_warning_note(tmp_path):
    with FakeAceStep() as fake:
        res = engine_for(tmp_path, fake.url).generate(khmer_request(vocal_language="km"), ctx_for(tmp_path)[0])
        assert fake.payloads[0]["vocal_language"] == "km"
    assert any("km" in n for n in res.notes)


def test_lyrics_too_long_rejected_before_calling_model(tmp_path):
    with FakeAceStep() as fake:
        with pytest.raises(StudioError) as exc:
            engine_for(tmp_path, fake.url).generate(khmer_request(lyrics="ក" * 5000), ctx_for(tmp_path)[0])
        assert exc.value.code == "invalid_request" and not fake.payloads


def test_model_failure_is_reported_with_server_detail(tmp_path):
    with FakeAceStep("fail") as fake:
        with pytest.raises(StudioError) as exc:
            engine_for(tmp_path, fake.url).generate(khmer_request(), ctx_for(tmp_path)[0])
    assert exc.value.code == "engine_failed" and "CUDA out of memory" in (exc.value.detail or "")


def test_queue_full_429(tmp_path):
    with FakeAceStep("busy") as fake:
        with pytest.raises(StudioError) as exc:
            engine_for(tmp_path, fake.url).generate(khmer_request(), ctx_for(tmp_path)[0])
    assert exc.value.code == "engine_busy"


def test_unreachable_server_gives_actionable_hint(tmp_path):
    eng = engine_for(tmp_path, "http://127.0.0.1:9")
    assert eng.health().state == "unreachable"
    with pytest.raises(EngineUnavailable) as exc:
        eng.generate(khmer_request(), ctx_for(tmp_path)[0])
    assert exc.value.code == "engine_unreachable" and "acestep-api" in (exc.value.hint or "")


def test_lost_task_is_detected(tmp_path):
    with FakeAceStep("lost") as fake:
        with pytest.raises(StudioError) as exc:
            engine_for(tmp_path, fake.url).generate(khmer_request(), ctx_for(tmp_path)[0])
    assert exc.value.code == "engine_failed"


def test_cancel_stops_waiting(tmp_path):
    with FakeAceStep() as fake:
        calls = {"n": 0}

        def cancel():
            calls["n"] += 1
            return calls["n"] > 3

        with pytest.raises(Cancelled):
            engine_for(tmp_path, fake.url).generate(khmer_request(), ctx_for(tmp_path, cancel=cancel)[0])


def test_health_reports_model_state(tmp_path):
    with FakeAceStep() as fake:
        fake.models_initialized = False
        h = engine_for(tmp_path, fake.url).health()
        assert h.ok and h.detail["models_initialized"] is False
        fake.models_initialized = True
        assert engine_for(tmp_path, fake.url).health().detail["models_initialized"] is True


def test_info_is_honest_about_khmer_and_separates_native_controls(tmp_path):
    info = engine_for(tmp_path, "http://127.0.0.1:9").info()
    assert info.khmer_status == "not_documented" and "km" in info.khmer_note
    assert info.license_name == "MIT"
    keys = {c["key"] for c in info.native_controls}
    assert {"duration", "bpm", "key_scale", "time_signature", "vocal_language", "seed", "steps"} <= keys
    assert "style" not in keys and "instruments" not in keys  # style/instruments are description-only, never "native"
