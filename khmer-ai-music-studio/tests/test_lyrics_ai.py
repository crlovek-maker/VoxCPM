"""Lyric helper tests against a FAKE OpenAI-compatible server (no real text model is involved)."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from conftest import KHMER_4_LINES, make_settings
from khmer_studio import lyrics_ai
from khmer_studio.errors import StudioError
from khmer_studio.main import create_app


class FakeLLM:
    def __init__(self, reply):
        self.reply, self.requests = reply, []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"data": []}')

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append(body)
                out = json.dumps({"choices": [{"message": {"content": outer.reply}}]}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(out)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)

    def __enter__(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *a):
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"


GOOD = '<think>hmm</think>```json\n{"suggestions":[{"lines":["១. ឃ្លាថ្មីមួយ","ឃ្លាថ្មីពីរ"],"note":"កែឱ្យជួន"},{"lines":["តែមួយបន្ទាត់"],"note":"x"}]}\n```'


def test_parse_suggestions_strips_think_and_numbering_and_flags_wrong_line_count():
    out = lyrics_ai.parse_suggestions(GOOD, expected_lines=2, count=3)
    assert out[0]["lines"] == ["ឃ្លាថ្មីមួយ", "ឃ្លាថ្មីពីរ"] and out[0]["line_count_ok"] is True and out[0]["note"] == "កែឱ្យជួន"
    assert out[1]["line_count_ok"] is False  # a suggestion with the wrong number of lines is flagged, not silently accepted


def test_parse_suggestions_plain_text_fallback_and_garbage():
    out = lyrics_ai.parse_suggestions("1. ក\n2. ខ", expected_lines=2, count=3)
    assert out and out[0]["lines"] == ["ក", "ខ"]
    assert lyrics_ai.parse_suggestions("", expected_lines=2, count=3) == []


def test_not_configured_is_explicit(client, project):
    r = client.post(f"/api/projects/{project['id']}/lyrics/assist", json={"mode": "rhyme", "section_id": project["lyrics"]["sections"][0]["id"]})
    assert r.status_code == 503 and r.json()["error"]["code"] == "llm_not_configured"
    assert client.get("/api/llm/status").json()["configured"] is False


def test_assist_endpoint_returns_suggestions_without_changing_lyrics(tmp_path):
    with FakeLLM(GOOD) as llm:
        app = create_app(make_settings(tmp_path, llm_base_url=llm.url, llm_model="fake-model"))
        with TestClient(app) as c:
            p = c.post("/api/projects", json={"title": "t", "lyrics_text": "[Chorus]\n" + "\n".join(KHMER_4_LINES)}).json()
            sid = p["lyrics"]["sections"][0]["id"]
            assert c.get("/api/llm/status").json()["reachable"] is True
            r = c.post(f"/api/projects/{p['id']}/lyrics/assist", json={"mode": "rhyme", "section_id": sid, "line_indexes": [1, 2], "instruction": "ឱ្យជួនគ្នា", "count": 2})
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["line_indexes"] == [1, 2] and len(data["suggestions"]) == 2
            # nothing was replaced: the user must choose first
            assert c.get(f"/api/projects/{p['id']}").json()["lyrics"]["sections"][0]["lines"] == KHMER_4_LINES
        sent = llm.requests[0]
        user_msg = sent["messages"][1]["content"]
        assert sent["model"] == "fake-model" and KHMER_4_LINES[1] in user_msg and KHMER_4_LINES[2] in user_msg
        assert KHMER_4_LINES[0] in user_msg  # neighbouring line is given as context
        assert "ឱ្យជួនគ្នា" in user_msg and "ពាក្យជួន" in user_msg
        assert "2." in user_msg and "exactly 2 lines" in user_msg


def test_llm_unreachable_message(tmp_path):
    s = make_settings(tmp_path, llm_base_url="http://127.0.0.1:9/v1", llm_model="m")
    with pytest.raises(StudioError) as exc:
        lyrics_ai.suggest(s, mode="rhyme", lines=["ក"])
    assert exc.value.code == "llm_unreachable" and "ollama" in exc.value.hint.lower()
    assert lyrics_ai.llm_status(s)["reachable"] is False
