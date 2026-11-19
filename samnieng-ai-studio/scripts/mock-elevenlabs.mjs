// A MOCK of the ElevenLabs Music endpoint for offline testing. It is NOT the real service.
// POST /v1/music -> returns a short silent-ish MP3-like blob (or an error, see /__mode).
// POST /__mode {"status":401|200|...} switches behavior.
import http from "node:http";

export function startMock(port = 0) {
  let status = 200;
  const requests = [];
  const mp3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(8192, 0)]);
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.url === "/__mode") {
        status = JSON.parse(raw).status;
        res.end("ok");
        return;
      }
      requests.push({ url: req.url, key: req.headers["xi-api-key"], body: raw ? JSON.parse(raw) : null });
      if (status === 200) {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(mp3);
      } else {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: { status: "mock_error", message: `mock provider returned ${status}` } }));
      }
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, requests, setStatus: (s) => (status = s) })));
}

if (process.argv[1].endsWith("mock-elevenlabs.mjs")) {
  const m = await startMock(Number(process.env.PORT) || 8787);
  console.log(`mock ElevenLabs listening on http://127.0.0.1:${m.port}`);
}
