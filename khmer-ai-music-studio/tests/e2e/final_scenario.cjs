// FINAL SCENARIO through the real browser UI (Playwright / Chromium):
//   new project from 4 Khmer lines, NO mp3 beforehand -> generate ONE chorus -> listen/download audio ->
//   cover -> tap line timings -> karaoke MP4 (YouTube + Shorts) -> publishing text -> reload persistence.
//
//   ENGINE=selftest|acestep  BASE=http://127.0.0.1:8000  OUT=dir  RESOLUTIONS=1280x720,1920x1080,1080x1920
//   CHORUS_SECONDS=10 (selftest only)  JOB_TIMEOUT_MS=900000  DEVICE=desktop|iphone
//
// Everything printed/recorded in report.json is what REALLY happened in this run.
const { chromium, devices } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const ENGINE = process.env.ENGINE || 'selftest';
const OUT = process.env.OUT || path.join(__dirname, 'output');
const JOB_TIMEOUT = Number(process.env.JOB_TIMEOUT_MS || 900000);
const RESOLUTIONS = (process.env.RESOLUTIONS || '1280x720').split(',');
const DEVICE = process.env.DEVICE || 'desktop';
const COVER = path.resolve(__dirname, '../../samples/cover_sample.jpg');
const LINES = ['ខ្ញុំស្រឡាញ់ស្រុកខ្មែរ ដូចបេះដូងខ្ញុំ', 'ទឹកដីដូនតា ភ្លឺថ្លាគ្រប់ពេល', 'ចម្រៀងនេះសូមឮ ក្នុងចិត្តជានិច្ច', 'ស្រុកខ្មែរអើយ ខ្ញុំនៅទីនេះ'];
const ENGINE_NAME = { acestep: 'ACE-Step 1.5', selftest: 'របៀបសាកល្បងប្រព័ន្ធ' }[ENGINE];
const RES_BUTTON = { '1920x1080': 'YouTube 1920×1080', '1080x1920': 'Shorts 1080×1920', '1280x720': 'សាកល្បងលឿន 1280×720' };

fs.mkdirSync(OUT, { recursive: true });
const report = { engine: ENGINE, device: DEVICE, started: new Date().toISOString(), steps: [], problems: [], evidence: {} };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const evidence = await fn();
    report.steps.push({ name, ok: true, seconds: +((Date.now() - t0) / 1000).toFixed(1), evidence: evidence || null });
    console.log(`✔ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return true;
  } catch (e) {
    report.steps.push({ name, ok: false, seconds: +((Date.now() - t0) / 1000).toFixed(1), error: String(e.message || e).split('\n')[0] });
    console.log(`✘ ${name}: ${String(e.message || e).split('\n')[0]}`);
    return false;
  }
}

const ffprobe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }));

async function waitJob(page, cardLocator, label, staleId = null) {
  const timeline = []; const t0 = Date.now(); let lastKey = ''; let shotTaken = false;
  while (Date.now() - t0 < JOB_TIMEOUT) {
    const visible = await cardLocator.isVisible().catch(() => false);
    const jobId = visible ? await cardLocator.getAttribute('data-job-id').catch(() => null) : null;
    if (visible && jobId && jobId !== staleId) {
      const st = (await cardLocator.locator('.badge').first().innerText()).trim();
      const msg = (await cardLocator.locator('div').nth(1).innerText().catch(() => '')).trim();
      const width = await cardLocator.locator('.bar > i').evaluate((el) => el.style.width).catch(() => '');
      const meta = (await cardLocator.locator('.small.muted').first().innerText().catch(() => '')).trim();
      const key = `${st}|${msg}|${width}`;
      if (key !== lastKey) { timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(1), status: st, message: msg, progress: width || null, meta }); lastKey = key; }
      if (!shotTaken && st === 'កំពុងដំណើរការ') { shotTaken = true; await shot(page, `${label}_running`); }
      if (st === 'ជោគជ័យ' || st === 'បរាជ័យ' || st === 'បានបោះបង់') { return { final: st, timeline }; }
    }
    await page.waitForTimeout(700);
  }
  return { final: 'timeout', timeline };
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctxOpts = DEVICE === 'iphone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } };
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'km-KH', acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.problems.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.problems.push('CONSOLE ' + m.text()); });
  page.on('response', (r) => { if (r.status() >= 500) report.problems.push(`HTTP${r.status()} ${r.url()}`); });

  let pid = null; let audioDuration = 0; let versionId = null;

  await step('1. បើកកម្មវិធី និងពិនិត្យស្ថានភាព', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('text=គម្រោងរបស់ខ្ញុំ');
    const health = await (await page.request.get(BASE + '/api/health?refresh=1')).json();
    const eng = health.engines.find((e) => e.id === ENGINE);
    if (!eng) throw new Error(`engine ${ENGINE} មិនមាន`);
    if (!eng.health.ok) throw new Error(`engine ${ENGINE} មិនទាន់ភ្ជាប់: ${eng.health.message}`);
    await shot(page, '01_home');
    return { ffmpeg: health.ffmpeg, engine: { id: eng.id, name: eng.name, is_ai: eng.is_ai, state: eng.health.state }, engine_health_detail: eng.health.detail };
  });

  await step('2. គម្រោងថ្មី ចាប់ផ្ដើមពីទំនុកខ្មែរ ៤ បន្ទាត់ (គ្មាន MP3 ជាមុន)', async () => {
    await page.getByRole('button', { name: /គម្រោងថ្មី/ }).first().click();
    await page.getByRole('button', { name: 'ប្រើទំនុកគំរូ ៤ បន្ទាត់' }).click();
    await page.getByPlaceholder('ឈ្មោះសិល្បករ (អាចបំពេញពេលក្រោយ)').fill('សាកល្បង AI');
    await page.getByRole('button', { name: 'បង្កើតគម្រោង' }).click();
    await page.waitForURL(/#\/p\/.+\/lyrics/);
    pid = page.url().match(/#\/p\/([^/]+)/)[1];
    await page.waitForSelector('.section-card textarea');
    const text = await page.inputValue('.section-card textarea');
    if (text !== LINES.join('\n')) throw new Error('ទំនុកមិនត្រូវនឹងគំរូ: ' + JSON.stringify(text));
    const type = await page.locator('.section-card select').first().inputValue();
    const proj = await (await page.request.get(`${BASE}/api/projects/${pid}`)).json();
    if (proj.versions.length !== 0) throw new Error('គួរគ្មានកំណែបទជាមុន');
    await shot(page, '02_lyrics');
    return { project_id: pid, section_type: type, lines: text.split('\n').length, versions_before: proj.versions.length };
  });

  await step(`3. ជ្រើសម៉ូដែល «${ENGINE_NAME}» ហើយចុច «សាកល្បង Chorus ខ្លី»`, async () => {
    await page.goto(`${BASE}/#/p/${pid}/music`);
    await page.waitForSelector('input[name=engine]');
    await page.locator('label.check', { hasText: ENGINE_NAME }).locator('input[type=radio]').check();
    await page.getByRole('button', { name: 'ខ្លុយ', exact: true }).click();
    await page.getByRole('button', { name: 'ហ្គីតា (អាកូស្ទិក)' }).click();
    if (process.env.CHORUS_SECONDS) await page.getByLabel('រយៈពេល Chorus សាកល្បង').fill(process.env.CHORUS_SECONDS);
    await shot(page, '03_music_form');
    await page.getByRole('button', { name: /សាកល្បង Chorus ខ្លី/ }).click();
  });

  let jobResult = null;
  await step('4. ស្ថានភាពការងារពិត រហូតដល់បញ្ចប់ (ជោគជ័យ)', async () => {
    const card = page.locator('.job').first();
    await card.waitFor({ state: 'visible', timeout: 30000 });
    jobResult = await waitJob(page, card, '04');
    report.evidence.job_timeline = jobResult.timeline;
    await shot(page, '04_job_done');
    if (jobResult.final !== 'ជោគជ័យ') {
      const err = await card.locator('.note.bad').innerText().catch(() => '');
      throw new Error(`ការងារបញ្ចប់ជា «${jobResult.final}» ${err.replace(/\n/g, ' ')}`);
    }
    return { final: jobResult.final, transitions: jobResult.timeline.length, first: jobResult.timeline[0], last: jobResult.timeline[jobResult.timeline.length - 1] };
  });

  await step('5. ស្ដាប់ក្នុងកម្មវិធី និងទាញយក WAV / MP3 ភ្លាមៗ', async () => {
    const card = page.locator('.version').first();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    await card.locator('.player .pp').click();
    await page.waitForTimeout(1800);
    const playing = await page.evaluate(() => [...window.__kmPlayers].map((p) => ({ paused: p.audio.paused, t: p.audio.currentTime, d: p.audio.duration })).filter((x) => !x.paused));
    if (!playing.length || !(playing[0].t > 0.5)) throw new Error('សំឡេងមិនបានចាក់ក្នុង browser: ' + JSON.stringify(playing));
    await card.locator('.player .pp').click(); // pause
    audioDuration = playing[0].d;
    const hrefWav = await card.locator('a[href*="format=wav"]').first().getAttribute('href');
    const hrefMp3 = await card.locator('a[href*="format=mp3"]').first().getAttribute('href');
    const wav = await page.request.get(BASE + hrefWav); const mp3 = await page.request.get(BASE + hrefMp3);
    const wavBuf = await wav.body(); const mp3Buf = await mp3.body();
    if (wav.status() !== 200 || wavBuf.slice(0, 4).toString() !== 'RIFF') throw new Error('WAV មិនត្រឹមត្រូវ');
    if (mp3.status() !== 200 || mp3Buf.length < 2000) throw new Error('MP3 មិនត្រឹមត្រូវ');
    fs.writeFileSync(path.join(OUT, 'chorus.wav'), wavBuf); fs.writeFileSync(path.join(OUT, 'chorus.mp3'), mp3Buf);
    const wi = ffprobe(path.join(OUT, 'chorus.wav')); const mi = ffprobe(path.join(OUT, 'chorus.mp3'));
    const proj = await (await page.request.get(`${BASE}/api/projects/${pid}`)).json();
    versionId = proj.versions[0].id;
    await shot(page, '05_version');
    return { played_seconds_in_browser: +playing[0].t.toFixed(2), wav: { bytes: wavBuf.length, codec: wi.streams[0].codec_name, rate: wi.streams[0].sample_rate, seconds: +wi.format.duration }, mp3: { bytes: mp3Buf.length, codec: mi.streams[0].codec_name, seconds: +mi.format.duration },
      version: { id: versionId, kind: proj.versions[0].kind, engine: proj.versions[0].engine, analysis: proj.versions[0].analysis, warnings: proj.versions[0].warnings, caption_sent: proj.versions[0].caption, request_sent: proj.versions[0].request, notes: proj.versions[0].notes } };
  });

  await step('6. រូបគម្រប៖ នាំចូលរូប ដាក់ចំណងជើងខ្មែរ រក្សាទុក (16:9) ជាផ្ទៃខាងក្រោយ MV', async () => {
    await page.goto(`${BASE}/#/p/${pid}/cover`);
    await page.waitForSelector('canvas#cover');
    await page.setInputFiles('input[type=file][aria-label="ជ្រើសរូបភាព"]', COVER);
    await page.waitForTimeout(1200);
    for (const a of ['1:1', '9:16', '16:9']) { await page.getByRole('button', { name: new RegExp('^' + a.replace(':', ':')) }).click(); await page.waitForTimeout(250); }
    await shot(page, '06_cover_editor');
    await page.getByRole('button', { name: /រក្សាទុករូបគម្រប/ }).click();
    await page.waitForSelector('.thumb img', { timeout: 20000 });
    const proj = await (await page.request.get(`${BASE}/api/projects/${pid}`)).json();
    const files = proj.cover.files;
    const first = Object.entries(files)[0];
    const png = await (await page.request.get(`${BASE}/media/${pid}/covers/${first[1].file}`)).body();
    fs.writeFileSync(path.join(OUT, 'cover_16x9.png'), png);
    if (!proj.cover.mv_background) throw new Error('មិនបានកំណត់ផ្ទៃខាងក្រោយ MV');
    return { aspects_saved: Object.keys(files), mv_background: proj.cover.mv_background, png_bytes: png.length, has_text: first[1].has_text, size: `${first[1].width}x${first[1].height}` };
  });

  await step('7. MV ខារ៉ាអូខេ៖ ចុចកំណត់ពេលចាប់ផ្ដើមឃ្លាទាំង ៤ ពេលកំពុងស្ដាប់', async () => {
    await page.goto(`${BASE}/#/p/${pid}/karaoke`);
    await page.waitForSelector('.linerow');
    const n = await page.locator('.linerow').count();
    if (n !== 4) throw new Error('គួរមាន ៤ ឃ្លា ប៉ុន្តែមាន ' + n);
    const texts = await page.locator('.linerow .txt').allInnerTexts();
    if (JSON.stringify(texts) !== JSON.stringify(LINES)) throw new Error('ទំនុកក្នុង MV មិនត្រូវនឹងទំនុកដើម');
    await page.locator('section .player .pp').first().click(); // play from 0
    const dur = await page.evaluate(() => [...window.__kmPlayers].find((p) => !p.audio.paused).audio.duration);
    const marks = [0.04, 0.28, 0.52, 0.76].map((f) => f * dur);
    const tapped = [];
    for (const m of marks) {
      await page.waitForFunction((t) => [...window.__kmPlayers].some((p) => !p.audio.paused && p.audio.currentTime >= t), m, { timeout: 120000 });
      await page.locator('.tapbtn').click();
      tapped.push(+(await page.evaluate(() => [...window.__kmPlayers].find((p) => !p.audio.paused).audio.currentTime)).toFixed(2));
    }
    await page.locator('section .player .pp').first().click(); // pause
    const times = await page.locator('.linerow input.time').evaluateAll((els) => els.map((e) => e.value));
    await page.waitForTimeout(1200); // autosave
    const proj = await (await page.request.get(`${BASE}/api/projects/${pid}`)).json();
    const saved = proj.karaoke.lines.map((l) => l.start);
    if (saved.some((s) => s === null || s === undefined)) throw new Error('ពេលមិនបានរក្សាទុកទាំងអស់: ' + JSON.stringify(saved));
    if (!saved.every((s, i) => i === 0 || s > saved[i - 1])) throw new Error('ពេលមិនកើនតាមលំដាប់: ' + JSON.stringify(saved));
    await shot(page, '07_karaoke_timed');
    return { tapped_at_seconds: tapped, input_values: times, saved_start_times: saved, lines_match_original: true };
  });

  await step('8. មើលស៊ុមពិត (libass) ជាមុន', async () => {
    await page.getByRole('button', { name: /មើលស៊ុមពិត/ }).click();
    await page.waitForSelector('.modal img', { timeout: 60000 });
    await page.waitForTimeout(500);
    const box = await page.locator('.modal img').boundingBox();
    await shot(page, '08_real_frame');
    await page.keyboard.press('Escape');
    return { img_box: box && { w: Math.round(box.width), h: Math.round(box.height) } };
  });

  for (const res of RESOLUTIONS) {
    await step(`9. បង្កើត MP4 ${res}`, async () => {
      const card = page.locator('.job').first();
      const staleId = await card.getAttribute('data-job-id').catch(() => null);
      await page.getByRole('button', { name: new RegExp(RES_BUTTON[res]) }).click();
      await card.waitFor({ state: 'visible', timeout: 30000 });
      const r = await waitJob(page, card, `09_${res}`, staleId);
      report.evidence[`mv_${res}_timeline`] = r.timeline;
      if (r.final !== 'ជោគជ័យ') throw new Error('MV ' + r.final + ' ' + (await card.locator('.note.bad').innerText().catch(() => '')));
      await page.waitForSelector('video');
      const proj = await (await page.request.get(`${BASE}/api/projects/${pid}`)).json();
      const out = proj.karaoke.outputs.filter((o) => o.resolution === res).pop();
      const dl = await page.request.get(`${BASE}/api/projects/${pid}/mv/${out.id}/download`);
      const buf = await dl.body();
      const file = path.join(OUT, `karaoke_${res}.mp4`);
      fs.writeFileSync(file, buf);
      const info = ffprobe(file);
      const v = info.streams.find((s) => s.codec_type === 'video'); const a = info.streams.find((s) => s.codec_type === 'audio');
      const [W, H] = res.split('x').map(Number);
      if (v.width !== W || v.height !== H) throw new Error(`ទំហំវីដេអូខុស ${v.width}x${v.height}`);
      if (buf.slice(4, 8).toString() !== 'ftyp') throw new Error('មិនមែន MP4');
      const videoMeta = await page.evaluate(async (src) => { const el = document.querySelector(`video[src="${src}"]`); if (!el) return null; await new Promise((r) => (el.readyState >= 1 ? r() : el.addEventListener('loadedmetadata', r, { once: true }))); return { w: el.videoWidth, h: el.videoHeight, d: el.duration }; }, `/media/${pid}/mv/${out.id}.mp4`);
      await shot(page, `09_mv_${res}`);
      return { file: `karaoke_${res}.mp4`, bytes: buf.length, video: `${v.codec_name} ${v.width}x${v.height} ${v.pix_fmt}`, audio: `${a.codec_name} ${a.sample_rate}Hz`, seconds: +info.format.duration, song_seconds: +audioDuration.toFixed(2), browser_video_meta: videoMeta };
    });
  }

  await step('10. រៀបចំបង្ហោះ៖ Description / Credits / Hashtags + ចម្លងមួយចុច', async () => {
    await page.goto(`${BASE}/#/p/${pid}/publish`);
    await page.getByPlaceholder('ឧ. បាឡាដ').fill('បាឡាដ');
    await page.getByRole('button', { name: /បង្កើតអត្ថបទ/ }).click();
    await page.waitForSelector('textarea[aria-label^="Description"]');
    const desc = await page.inputValue('textarea[aria-label^="Description"]');
    for (const l of LINES) if (!desc.includes(l)) throw new Error('Description ខ្វះទំនុក: ' + l);
    await page.getByRole('button', { name: /ចម្លងទាំងអស់/ }).click();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    const tabs = [];
    for (const t of ['▶ YouTube', '📘 Facebook', '🎵 TikTok']) { await page.getByRole('button', { name: t }).click(); tabs.push({ t, chars: (await page.inputValue('textarea[aria-label^="Description"]')).length }); }
    await shot(page, '10_publish');
    return { clipboard_has_description: !!(clip && clip.includes(LINES[0])), platforms: tabs };
  });

  await step('11. បិទ/បើកឡើងវិញ៖ គម្រោងនៅដដែល (កែបន្តបាន)', async () => {
    await page.goto('about:blank');
    await page.goto(`${BASE}/#/p/${pid}/karaoke`);
    await page.waitForSelector('.linerow');
    const times = await page.locator('.linerow input.time').evaluateAll((els) => els.map((e) => e.value));
    const outputs = await page.locator('video').count();
    if (times.some((t) => !t)) throw new Error('ពេលបាត់បន្ទាប់ពីបើកឡើងវិញ');
    if (outputs < RESOLUTIONS.length) throw new Error('MV បាត់');
    return { times_after_reload: times, mv_videos_listed: outputs };
  });

  report.finished = new Date().toISOString();
  report.passed = report.steps.filter((s) => s.ok).length; report.failed = report.steps.filter((s) => !s.ok).length;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nសរុប: ជាប់ ${report.passed} · ធ្លាក់ ${report.failed} · បញ្ហា JS/HTTP ${report.problems.length}`);
  report.problems.slice(0, 10).forEach((p) => console.log('  !', p));
  await browser.close();
  process.exit(report.failed || report.problems.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
