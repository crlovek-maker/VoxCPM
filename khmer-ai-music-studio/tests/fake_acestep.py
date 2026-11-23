"""A FAKE ACE-Step API server used only by the adapter tests.

It copies the request/response SHAPES of the real `acestep-api` (docs/en/API.md and the server
source, and what a real CPU run returned: `result[0]` carries `stage`/`progress` while running, the
finished item carries `file: "/v1/audio?path=..."`, `seed_value`, `dit_model`). It does NOT run any
model — passing these tests proves the adapter speaks the protocol, not that a model sings Khmer.
"""
from __future__ import annotations

import io
import json
import math
import struct
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse


def make_wav(seconds: float = 1.0, rate: int = 48000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(seconds * rate)):
            v = int(8000 * math.sin(2 * math.pi * 440 * i / rate))
            frames += struct.pack("<hh", v, v)
        w.writeframes(bytes(frames))
    return buf.getvalue()


class FakeAceStep:
    def __init__(self, mode: str = "ok") -> None:
        self.mode = mode  # ok | fail | busy | lost
        self.payloads: List[Dict[str, Any]] = []
        self.polls: Dict[str, int] = {}
        self.models_initialized = True
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence
                pass

            def _send(self, code: int, body: Any, ctype: str = "application/json") -> None:
                data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body, ensure_ascii=False).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _wrap(self, data: Any) -> Dict[str, Any]:
                return {"data": data, "code": 200, "error": None, "timestamp": 0, "extra": None}

            def do_GET(self):
                url = urlparse(self.path)
                if url.path == "/health":
                    return self._send(200, self._wrap({
                        "status": "ok", "service": "ACE-Step API", "version": "1.0",
                        "models_initialized": outer.models_initialized, "llm_initialized": False,
                        "loaded_model": "acestep-v15-turbo", "loaded_lm_model": None,
                    }))
                if url.path == "/v1/audio":
                    assert parse_qs(url.query).get("path"), "path parameter missing"
                    return self._send(200, make_wav(1.0), "audio/wav")
                self._send(404, {"detail": "not found"})

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/release_task":
                    if outer.mode == "busy":
                        return self._send(429, {"detail": "Server busy: queue is full"})
                    outer.payloads.append(body)
                    return self._send(200, self._wrap({"task_id": "task-1", "status": "queued", "queue_position": 1}))
                if self.path == "/query_result":
                    tid = body["task_id_list"][0]
                    n = outer.polls[tid] = outer.polls.get(tid, 0) + 1
                    if outer.mode == "lost":
                        return self._send(200, self._wrap([{"task_id": tid, "result": "[]", "status": 0}]))
                    script = [
                        (0, {"stage": "queued", "progress": 0.0}),
                        (0, {"stage": "Generating music (batch size: 1)...", "progress": 0.6}),
                        (0, {"stage": "Decoding audio...", "progress": 0.8}),
                    ]
                    if n <= len(script):
                        status, item = script[n - 1]
                        item = {"file": "", "wave": "", "status": 0, "create_time": 0, "env": "development", "prompt": "", "lyrics": "", "metas": {}, **item, "error": None}
                        return self._send(200, self._wrap([{"task_id": tid, "result": json.dumps([item]), "status": status, "progress_text": "\x1b[A02:29:43 | INFO | working"}]))
                    if outer.mode == "fail":
                        item = {"file": "", "status": 2, "stage": "failed", "progress": 0.5, "error": "CUDA out of memory (fake)"}
                        return self._send(200, self._wrap([{"task_id": tid, "result": json.dumps([item]), "status": 2, "progress_text": "failed"}]))
                    item = {
                        "file": "/v1/audio?path=%2Ftmp%2Fapi_audio%2Ffake.wav", "wave": "", "status": 1, "create_time": 0, "env": "development",
                        "prompt": body.get("prompt", ""), "lyrics": "", "metas": {"duration": 30.0}, "generation_info": "fake",
                        "seed_value": "42,43", "lm_model": "", "dit_model": "acestep-v15-turbo",
                    }
                    return self._send(200, self._wrap([{"task_id": tid, "result": json.dumps([item]), "status": 1, "progress_text": "done"}]))
                self._send(404, {"detail": "not found"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def __enter__(self) -> "FakeAceStep":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
