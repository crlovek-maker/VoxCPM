import http from "node:http";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { coerceInput } from "@/lib/validate";
import sample from "../samples/khmer-sample.json";

// ── a MOCK of the ElevenLabs endpoint (NOT the live service) ──────────────────────────
let server: http.Server;
let base = "";
let behavior: { status: number; body?: unknown } = { status: 200 };
const seen: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
const FAKE_MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(4096, 1)]);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      if (behavior.status === 200) {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        res.end(FAKE_MP3);
      } else {
        res.writeHead(behavior.status, { "content-type": "application/json" });
        res.end(JSON.stringify(behavior.body ?? { detail: { status: "x", message: "boom" } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.DATA_DIR = path.join(mkdtempSync(path.join(tmpdir(), "samnieng-")), "data");
});
afterAll(() => server.close());
beforeEach(() => {
  seen.length = 0;
  behavior = { status: 200 };
  process.env.ELEVENLABS_API_KEY = "test-key";
  process.env.ELEVENLABS_BASE_URL = base;
  delete process.env.MUSIC_PROVIDER;
});

async function settle(id: string, getJobFresh: (id: string) => Promise<any>) {
  for (let i = 0; i < 100; i++) {
    const j = await getJobFresh(id);
    if (j.status === "succeeded" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job did not settle");
}

describe("ElevenLabs adapter against a mock server", () => {
  it("sends key in header, composition_plan with verbatim lyrics, and stores the returned mp3", async () => {
    const { enqueue, getJobFresh } = await import("@/lib/runner");
    const { job } = await enqueue(coerceInput(sample));
    const done = await settle(job.id, getJobFresh);
    expect(done.status).toBe("succeeded");
    expect(done.result.audio).toMatchObject({ format: "mp3", mime: "audio/mpeg", bytes: FAKE_MP3.length });
    const call = seen[0];
    expect(call.url).toBe("/v1/music?output_format=mp3_44100_128");
    expect(call.headers["xi-api-key"]).toBe("test-key");
    expect(call.body.model_id).toBe("music_v1");
    expect(call.body.prompt).toBeUndefined();
    expect(call.body.composition_plan.sections[1].lines[0]).toBe("យប់នេះខែភ្លឺ លើទន្លេមេគង្គា");
    expect(JSON.stringify(job)).not.toContain("test-key");
    const { audioPath } = await import("@/lib/store");
    expect(existsSync(audioPath(job.id, done.result.audio.file)!)).toBe(true);
  });

  it("instrumental sends prompt + force_instrumental", async () => {
    const { enqueue, getJobFresh } = await import("@/lib/runner");
    const { job } = await enqueue({ ...coerceInput(sample), outputMode: "instrumental", title: "inst" });
    await settle(job.id, getJobFresh);
    expect(seen[0].body).toMatchObject({ force_instrumental: true });
    expect(seen[0].body.composition_plan).toBeUndefined();
  });

  it.each([
    [401, "PROVIDER_AUTH"],
    [402, "PROVIDER_QUOTA"],
    [422, "PROVIDER_REJECTED"],
    [429, "PROVIDER_RATE_LIMIT"],
    [500, "PROVIDER_ERROR"],
  ])("maps HTTP %i to %s and surfaces the provider message", async (status, code) => {
    behavior = { status: status as number, body: { detail: { status: "bad", message: "provider says no" } } };
    const { enqueue, getJobFresh } = await import("@/lib/runner");
    const { job } = await enqueue({ ...coerceInput(sample), title: `err-${status}` });
    const done = await settle(job.id, getJobFresh);
    expect(done.status).toBe("failed");
    expect(done.error.code).toBe(code);
    expect(done.error.message).toContain("provider says no");
  });

  it("retry creates a new job from a failed one and can succeed", async () => {
    behavior = { status: 500 };
    const { enqueue, getJobFresh, retryJob } = await import("@/lib/runner");
    const { job } = await enqueue({ ...coerceInput(sample), title: "retry-me" });
    expect((await settle(job.id, getJobFresh)).status).toBe("failed");
    behavior = { status: 200 };
    const { job: second } = await retryJob(job.id);
    expect(second.retryOf).toBe(job.id);
    expect((await settle(second.id, getJobFresh)).status).toBe("succeeded");
  });

  it("network failure is reported as NETWORK", async () => {
    process.env.ELEVENLABS_BASE_URL = "http://127.0.0.1:1";
    const { enqueue, getJobFresh } = await import("@/lib/runner");
    const { job } = await enqueue({ ...coerceInput(sample), title: "net" });
    expect((await settle(job.id, getJobFresh)).error.code).toBe("NETWORK");
  });
});

describe("runner guards", () => {
  it("refuses with MISSING_CREDENTIALS when live is required but no key", async () => {
    process.env.MUSIC_PROVIDER = "elevenlabs";
    delete process.env.ELEVENLABS_API_KEY;
    const { enqueue } = await import("@/lib/runner");
    await expect(enqueue(coerceInput(sample))).rejects.toMatchObject({ code: "MISSING_CREDENTIALS", status: 503 });
  });

  it("rejects invalid input and unsupported vocals-only", async () => {
    const { enqueue } = await import("@/lib/runner");
    await expect(enqueue(coerceInput({ title: "", lyrics: "" }))).rejects.toMatchObject({ code: "INVALID_INPUT", status: 400 });
    await expect(enqueue({ ...coerceInput(sample), outputMode: "vocals" })).rejects.toMatchObject({ code: "UNSUPPORTED_CAPABILITY" });
  });

  it("identical in-flight submissions return the same job (no duplicate provider calls)", async () => {
    process.env.MUSIC_PROVIDER = "demo";
    const { enqueue, getJobFresh } = await import("@/lib/runner");
    const i = { ...coerceInput(sample), title: "dupe" };
    const a = await enqueue(i);
    const b = await enqueue(i);
    expect(b.duplicate).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect((await settle(a.job.id, getJobFresh)).status).toBe("succeeded");
  });

  it("orphaned running jobs are marked INTERRUPTED instead of hanging forever", async () => {
    const { getJobFresh } = await import("@/lib/runner");
    const { saveJob } = await import("@/lib/store");
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    const now = new Date().toISOString();
    await saveJob({ id, createdAt: now, updatedAt: now, status: "running", stage: "generating", progress: null, provider: { id: "x", label: "x", mode: "live" }, input: coerceInput(sample), inputHash: "h", controls: [], warnings: [] });
    const j = await getJobFresh(id);
    expect(j?.status).toBe("failed");
    expect(j?.error?.code).toBe("INTERRUPTED");
  });
});
