// "Model sings Khmer unclearly -> sing it yourself": instrumental made by the app + the user's own voice, mixed.
// Uses Chromium's FAKE microphone (a generated tone), so this proves the browser recording -> upload -> FFmpeg mix
// pipeline, not a real singer or a real iPhone microphone.
//   node tests/e2e/own_voice.cjs     (BASE=http://127.0.0.1:8000, studio started with the selftest engine available)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra }); console.log(`${ok ? '✔' : '✘'} ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'km-KH' });
  await ctx.grantPermissions(['microphone']);
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('CONSOLE ' + m.text()); });

  const api = async (method, url, body) => { const r = await page.request.fetch(BASE + url, { method, data: body, headers: body ? { 'Content-Type': 'application/json' } : {} }); return r.json(); };
  const proj = await api('POST', '/api/projects', { title: 'សំឡេងខ្ញុំ', artist: 'ខ្ញុំ', lyrics_text: '[Chorus]\nឃ្លាទី១\nឃ្លាទី២' });
  const pid = proj.id;
  const job = await api('POST', `/api/projects/${pid}/generate`, { mode: 'full', engine: 'selftest', instrumental: true, music: { duration: 8 } });
  for (let i = 0; i < 60; i++) { const j = await api('GET', `/api/jobs/${job.id}`); if (j.status !== 'queued' && j.status !== 'running') { check('instrumental created by the app', j.status === 'succeeded', { status: j.status }); break; } await page.waitForTimeout(500); }

  await page.goto(`${BASE}/#/p/${pid}/music`);
  await page.waitForSelector('text=សំឡេងខ្ញុំច្រៀងផ្ទាល់');
  const mic = await page.evaluate(() => ({ secure: window.isSecureContext, recorder: typeof MediaRecorder !== 'undefined', devices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) }));
  check('microphone API available (localhost is a secure context)', mic.secure && mic.recorder && mic.devices, mic);
  const recBtn = page.getByRole('button', { name: /ថតសំឡេងច្រៀងតាមភ្លេង/ });
  await recBtn.waitFor({ timeout: 10000 });
  await recBtn.click();
  await page.waitForSelector('text=ឈប់ថត', { timeout: 10000 });
  await page.waitForTimeout(3200);
  const playingWhileRecording = await page.evaluate(() => true); // the sing-along audio is a detached Audio(); recording state is what we verify
  await page.getByRole('button', { name: /ឈប់ថត/ }).click();
  await page.waitForFunction(() => document.body.innerText.includes('បានរក្សាទុកសំឡេងរបស់អ្នក'), null, { timeout: 30000 }).catch(() => {});
  let p = await api('GET', `/api/projects/${pid}`);
  const rec = p.voice_recordings[0];
  check('recording uploaded and converted to WAV on the server', rec && rec.duration >= 2.0, rec && { duration: rec.duration, offset: rec.offset, file: rec.file });
  if (rec) {
    const wav = await (await page.request.get(`${BASE}/media/${pid}/voice/${rec.id}.wav`)).body();
    fs.writeFileSync(path.join(OUT, 'my_voice_fake_mic.wav'), wav);
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', path.join(OUT, 'my_voice_fake_mic.wav')], { encoding: 'utf8' }));
    check('voice file is real WAV audio', wav.slice(0, 4).toString() === 'RIFF' && info.streams[0].codec_name === 'pcm_s16le', { rate: info.streams[0].sample_rate, channels: info.streams[0].channels });
  }
  void playingWhileRecording;

  // adjust both levels and the offset, preview, then save as a new version
  await page.locator('input[type=range]').nth(-3).fill('-9').catch(() => {});
  await page.getByRole('button', { name: /ស្ដាប់សាកល្បង \(៣០ វិនាទី\)/ }).click();
  await page.waitForTimeout(2500);
  const playing = await page.evaluate(() => [...window.__kmPlayers].filter((pl) => !pl.audio.paused).length);
  check('mix preview plays in the browser', playing >= 1, { players_playing: playing });
  await page.getByRole('button', { name: /រក្សាទុកជាកំណែថ្មី/ }).click();
  let mix = null;
  for (let i = 0; i < 60; i++) { p = await api('GET', `/api/projects/${pid}`); mix = p.versions.find((v) => v.kind === 'mix'); if (mix) break; await page.waitForTimeout(500); }
  check('mixed version saved (music + my voice) and selected for the MV', mix && p.selected_version_id === mix.id, mix && { duration: mix.duration, source: mix.source });
  if (mix) {
    const wav = await (await page.request.get(`${BASE}/api/projects/${pid}/versions/${mix.id}/download?format=wav`)).body();
    fs.writeFileSync(path.join(OUT, 'mix_music_plus_voice.wav'), wav);
    check('downloadable mixed WAV', wav.slice(0, 4).toString() === 'RIFF' && wav.length > 100000, { bytes: wav.length });
  }
  await page.screenshot({ path: path.join(OUT, 'own_voice_panel.png'), fullPage: true });
  check('no JS errors', problems.length === 0, problems.slice(0, 3));
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'own_voice_report.json'), JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
