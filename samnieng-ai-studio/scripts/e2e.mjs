// End-to-end browser run. Phase A: demo mode. Phase B: live-adapter path against a MOCK provider
// (failure -> localized error -> retry). Phase C: "live required but no key" refusal.
// Requires: `npm run build` first, and playwright (preinstalled in some environments, else `npm i -D playwright`).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { startMock } from "./mock-elevenlabs.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = process.env.E2E_OUT || "test-output";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};

function startApp(port, env, dataDir) {
  rmSync(dataDir, { recursive: true, force: true });
  const clean = { ...process.env };
  delete clean.ELEVENLABS_API_KEY;
  delete clean.MUSIC_PROVIDER;
  delete clean.ELEVENLABS_BASE_URL;
  const p = spawn("npx", ["next", "start", "-p", String(port)], { env: { ...clean, DATA_DIR: dataDir, ...env }, stdio: "ignore", detached: true });
  process.on("exit", () => { try { process.kill(-p.pid, "SIGTERM"); } catch {} });
  return { port, stop: () => { try { process.kill(-p.pid, "SIGTERM"); } catch {} }, url: `http://127.0.0.1:${port}` };
}
async function waitUp(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url + "/api/capabilities")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start: " + url);
}

const browser = await chromium.launch();
const sample = JSON.parse((await import("node:fs")).readFileSync("samples/khmer-sample.json", "utf8"));

try {
  // ───────────────────────── Phase A: demo mode ─────────────────────────
  const A = startApp(3111, {}, ".data-e2e-a");
  await waitUp(A.url);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(A.url);
  await page.waitForSelector("[data-testid=demo-banner]");
  check("A1 default UI is Khmer", (await page.locator("h1").innerText()).includes("សំនៀង") && (await page.locator("html").getAttribute("lang")) === "km");
  check("A2 demo banner shown", (await page.locator("[data-testid=demo-banner]").innerText()).includes("DEMO"));
  check("A3 Khmer-unverified warning shown", await page.locator("[data-testid=khmer-warning]").isVisible());
  check("A4 vocals-only disabled (no provider support)", await page.getByRole("radio", { name: /សំឡេងច្រៀងដាច់ដោយឡែក/ }).isDisabled());
  await page.screenshot({ path: `${OUT}/a1-mobile-empty.png`, fullPage: true });

  // validation
  await page.getByTestId("generate").click();
  check("A5 empty form shows validation errors", (await page.locator(".field-err").count()) >= 1);

  // sample project
  await page.getByRole("button", { name: "ផ្ទុកគម្រោងគំរូភាសាខ្មែរ" }).click();
  check("A6 sample loaded into title + lyrics", (await page.locator("#title").inputValue()) === sample.title && (await page.locator("#lyrics").inputValue()) === sample.lyrics);
  check("A7 structure lists 6 sections", (await page.locator(".sections").first().locator(".sec").count()) === 6);
  const secVoiceRows = page.locator("section[aria-labelledby=s3] .sec");
  check("A8 duet shows voice assignment for 5 lyric sections", (await secVoiceRows.count()) === 5);
  await secVoiceRows.nth(0).getByRole("button", { name: "ស្រី" }).click();
  check("A9 Verse 1 reassigned to Female", (await secVoiceRows.nth(0).locator("button.on").innerText()) === "ស្រី");
  check("A10 lyrics untouched by editing voices/hints", (await page.locator("#lyrics").inputValue()) === sample.lyrics);

  // language switch
  await page.getByTestId("lang-toggle").click();
  check("A11 English switch translates editor", (await page.locator("section[aria-labelledby=s1] h2").innerText()).includes("Song") && (await page.getByText("Generate song").count()) === 1);
  await page.screenshot({ path: `${OUT}/a2-mobile-english-filled.png`, fullPage: true });
  await page.getByTestId("lang-toggle").click();

  // generate with double-click race
  await page.getByTestId("generate").dblclick();
  await page.waitForSelector("[data-testid=job-card]");
  const flightCard = page.locator("[data-testid=job-card]");
  check("A12 progress card appears", ["queued", "running"].includes(await flightCard.getAttribute("data-status")));
  await page.screenshot({ path: `${OUT}/a3-mobile-progress.png` });
  await page.waitForSelector("[data-testid=job-card][data-status=succeeded]", { timeout: 30000 });
  check("A13 duplicate double-click created exactly one job", (await page.getByTestId("history-item").count()) === 1);
  const src = await page.getByTestId("player").getAttribute("src");
  const audioRes = await fetch(A.url + src);
  const bytes = Buffer.from(await audioRes.arrayBuffer());
  check("A14 audio endpoint serves real WAV bytes", audioRes.ok && bytes.subarray(0, 4).toString() === "RIFF" && audioRes.headers.get("content-type") === "audio/wav", `${bytes.length} bytes`);
  const range = await fetch(A.url + src, { headers: { range: "bytes=0-99" } });
  check("A15 Range request returns 206 for seeking", range.status === 206 && (await range.arrayBuffer()).byteLength === 100);
  const dl = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /ទាញយក WAV/ }).click()]);
  const { readFileSync } = await import("node:fs");
  const dlBytes = readFileSync(await dl[0].path());
  const cd = (await fetch(A.url + src + "?download=1")).headers.get("content-disposition") ?? "";
  check("A16 download delivers actual WAV file; Content-Disposition has .wav + UTF-8 Khmer title", dlBytes.subarray(0, 4).toString() === "RIFF" && cd.includes('filename="song.wav"') && cd.includes("filename*=UTF-8''%E1%9E%96") && cd.endsWith(".wav"), cd.slice(0, 60));
  check("A17 no stem downloads shown (provider returned none)", (await page.locator('a[href*="stem="]').count()) === 0);
  check("A18 audio element can load media", await page.evaluate(() => new Promise((res) => { const a = document.querySelector("audio"); if (a.readyState >= 1) return res(a.duration > 1); a.addEventListener("loadedmetadata", () => res(a.duration > 1)); a.addEventListener("error", () => res(false)); a.load(); })));
  await page.locator("details", { hasText: "អ្វីដែលបានផ្ញើ" }).locator("summary").click();
  const ctlText = await page.locator("details", { hasText: "អ្វីដែលបានផ្ញើ" }).innerText();
  check("A19 control report labels section voices/hints as unavailable in demo", /សំឡេងតាមផ្នែក\s*មិនមាន/.test(ctlText.replace(/\n/g, " ")) || ctlText.includes("មិនមាន"));
  await page.screenshot({ path: `${OUT}/a4-mobile-done.png`, fullPage: true });

  // refresh resumes completed job
  await page.reload();
  await page.waitForSelector("[data-testid=job-card][data-status=succeeded]");
  check("A20 refresh restores history + playable result", (await page.getByTestId("player").count()) === 1);

  // refresh mid-generation resumes progress
  await page.getByRole("button", { name: "កែជាបទថ្មី" }).click();
  await page.locator("#title").fill("Resume test");
  await page.getByTestId("generate").click();
  await page.waitForSelector("[data-testid=job-card][data-status=running], [data-testid=job-card][data-status=queued]");
  await page.reload();
  await page.waitForSelector("[data-testid=job-card]");
  const midStatus = await page.locator("[data-testid=job-card]").getAttribute("data-status");
  await page.waitForSelector("[data-testid=job-card][data-status=succeeded]", { timeout: 30000 });
  check("A21 refresh during generation resumes tracking to completion", ["queued", "running", "succeeded"].includes(midStatus), `status after reload: ${midStatus}`);
  check("A22 history now has 2 songs", (await page.getByTestId("history-item").count()) === 2);

  // delete
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("history-item").first().getByRole("button", { name: "លុប" }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=history-item]").length === 1);
  check("A23 delete removes a song", true);

  // desktop layout
  const d = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await d.goto(A.url);
  await d.waitForSelector("[data-testid=job-card]");
  await d.screenshot({ path: `${OUT}/a5-desktop.png` });
  check("A24 desktop shows editor and library side by side", (await d.locator(".pane-create").isVisible()) && (await d.locator(".pane-library").isVisible()));
  check("A25 no page errors", errors.length === 0, errors.join("|"));
  await d.close();
  await ctx.close();
  A.stop();

  // ─────────── Phase B: live-adapter path vs MOCK provider (failure → retry) ───────────
  const mock = await startMock();
  mock.setStatus(401);
  const B = startApp(3112, { ELEVENLABS_API_KEY: "mock-key", ELEVENLABS_BASE_URL: `http://127.0.0.1:${mock.port}` }, ".data-e2e-b");
  await waitUp(B.url);
  const bp = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await bp.goto(B.url);
  await bp.waitForSelector("[data-testid=live-banner]");
  check("B1 live banner shown when key present (mock)", true);
  await bp.getByRole("button", { name: "ផ្ទុកគម្រោងគំរូភាសាខ្មែរ" }).click();
  const s3 = (await bp.locator("section[aria-labelledby=s3]").innerText()).replace(/\n/g, " ");
  check("B2 duet section-voice badge says Guidance (not Native)", /អ្នកណាច្រៀងផ្នែកនីមួយៗ\s*ការណែនាំ/.test(s3), s3.slice(0, 160));
  await bp.getByTestId("generate").click();
  await bp.waitForSelector("[data-testid=job-card][data-status=failed]", { timeout: 20000 });
  const errTxt = await bp.locator(".errbox").innerText();
  check("B3 provider 401 → localized Khmer error + provider message", errTxt.includes("សោ API") && errTxt.includes("mock provider returned 401"), errTxt.replace(/\n/g, " | "));
  check("B4 request used header key + composition_plan with verbatim lyrics", mock.requests[0]?.key === "mock-key" && mock.requests[0].body.composition_plan.sections.length === 6 && mock.requests[0].body.composition_plan.sections[3].lines[0] === "ឱព្រះចន្ទអើយ សូមបំភ្លឺផ្លូវឱ្យយើង");
  await bp.screenshot({ path: `${OUT}/b1-failed.png`, fullPage: true });
  mock.setStatus(200);
  await bp.getByRole("button", { name: "ព្យាយាមម្តងទៀត" }).click();
  await bp.waitForSelector("[data-testid=job-card][data-status=succeeded]", { timeout: 20000 });
  check("B5 retry succeeds and result is MP3", (await bp.getByRole("link", { name: /ទាញយក MP3/ }).count()) === 1);
  check("B6 history keeps both failed + retried records", (await bp.getByTestId("history-item").count()) === 2);
  check("B7 API key never present in page HTML/JSON", !(await bp.content()).includes("mock-key") && !JSON.stringify(await (await fetch(B.url + "/api/jobs")).json()).includes("mock-key"));
  B.stop();
  mock.server.close();

  // ─────────── Phase C: live required, no key ───────────
  const C = startApp(3113, { MUSIC_PROVIDER: "elevenlabs" }, ".data-e2e-c");
  await waitUp(C.url);
  const cp = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await cp.goto(C.url);
  await cp.waitForSelector(".banner.warn[role=alert]");
  check("C1 missing-credentials banner shown and Generate disabled", await cp.getByTestId("generate").isDisabled());
  const r = await fetch(C.url + "/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sample) });
  check("C2 API refuses with 503 MISSING_CREDENTIALS", r.status === 503 && (await r.json()).error.code === "MISSING_CREDENTIALS");
  C.stop();
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
