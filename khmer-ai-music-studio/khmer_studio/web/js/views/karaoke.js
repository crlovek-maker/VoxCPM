// Panel 4 — karaoke MV: tap to set each line's start while listening, fine-tune, preview, render MP4 (FFmpeg).
import { api, errorText } from '../api.js';
import { state, setProject } from '../state.js';
import { createPlayer } from '../player.js';
import { trackJob, makeJobCard, isActive } from '../jobs.js';
import { h, clear, toast, modal, confirmDialog, debounce, badge, fmtTime, parseTime, fmtDuration, fmtDate, fmtBytes } from '../ui.js';

const KIND = { full: 'បទពេញ', chorus_test: 'Chorus សាកល្បង', mix: 'ភ្លេង+សំឡេងខ្ញុំ', upload: 'នាំចូល' };
const RES_LABEL = { '1920x1080': '1920×1080 · YouTube (ផ្ដេក)', '1080x1920': '1080×1920 · Shorts/TikTok (បញ្ឈរ)', '1280x720': '1280×720 · សាកល្បងលឿន' };

export async function renderKaraoke(root, { project, pid }) {
  let p = project;
  if (!p.versions.length) {
    root.append(h('div', { class: 'card center stack' }, h('div', { style: { fontSize: '2.2rem' } }, '🎤'),
      h('p', null, 'មិនទាន់មានបទសម្រាប់ធ្វើ MV ទេ។ សូមបង្កើតបទ (ឬ «សាកល្បង Chorus») ក្នុងផ្ទាំង «តន្ត្រី» ជាមុន។'),
      h('div', null, h('a', { class: 'btn primary', href: `#/p/${pid}/music` }, '← ទៅផ្ទាំងតន្ត្រី'))));
    return null;
  }
  const presets = state.presets;
  let versionId = p.karaoke.version_id || p.selected_version_id || (p.versions.find((v) => !v.instrumental) || p.versions[0]).id;
  let lines = [];
  let style = { ...presets.karaoke_defaults, ...p.karaoke.style };
  let nextIdx = 0; const undo = [];
  let player = null; let raf = 0; let useCurrent = false; let loopIdx = null;
  const cleanups = [];

  // -------------------------- saving --------------------------
  const saveState = h('span', { class: 'savestate' }, '');
  const save = debounce(async () => {
    saveState.className = 'savestate'; saveState.textContent = 'កំពុងរក្សាទុក…';
    try { setProject(p = await api.put(`/api/projects/${pid}/karaoke`, { version_id: versionId, lines, style })); saveState.className = 'savestate ok'; saveState.textContent = 'រក្សាទុករួច ✓'; }
    catch (e) { saveState.className = 'savestate bad'; saveState.textContent = errorText(e); }
  }, 600);

  // -------------------------- version + lines --------------------------
  const versionSel = h('select', { 'aria-label': 'កំណែបទសម្រាប់ MV' });
  const useCurrentBox = h('input', { type: 'checkbox' });
  function fillVersions() {
    clear(versionSel);
    [...p.versions].reverse().forEach((v) => versionSel.append(h('option', { value: v.id, selected: v.id === versionId }, `${v.label} · ${KIND[v.kind] || v.kind}${v.instrumental ? ' (ភ្លេងសុទ្ធ)' : ''} · ${fmtDuration(v.duration)}`)));
  }
  async function loadVersion(id) {
    save.cancel(); versionId = id;
    const r = await api.post(`/api/projects/${pid}/karaoke/init`, { version_id: id, use_current_lyrics: useCurrent });
    setProject(p = r); lines = p.karaoke.lines.map((l) => ({ ...l })); const firstUnset = lines.findIndex((l) => l.start == null); nextIdx = firstUnset < 0 ? lines.length : firstUnset; undo.length = 0; // all timed -> nothing to tap (avoid overwriting line 1 by accident)
    if (player) player.destroy();
    player = createPlayer(`/media/${pid}/audio/${id}.wav`);
    playerBox.replaceChildren(player.el);
    applySpeed(); loopIdx = null;
    player.audio.addEventListener('play', startLoop); player.audio.addEventListener('pause', () => { cancelAnimationFrame(raf); paintPreview(); }); player.audio.addEventListener('seeked', paintPreview);
    drawLines(); paintStatus(); paintPreview();
  }
  versionSel.addEventListener('change', () => loadVersion(versionSel.value).catch((e) => toast(errorText(e), 'bad')));
  useCurrentBox.addEventListener('change', () => { useCurrent = useCurrentBox.checked; loadVersion(versionSel.value).catch((e) => toast(errorText(e), 'bad')); });

  // -------------------------- tap timing --------------------------
  const tapBtn = h('button', { class: 'primary tapbtn', type: 'button', 'aria-label': 'ចុចដើម្បីកំណត់ពេលចាប់ផ្ដើមឃ្លា' });
  const status = h('div', { class: 'small' });
  const undoBtn = h('button', { class: 'sm', type: 'button', onClick: () => { const u = undo.pop(); if (!u) return; lines[u.i].start = u.prev; nextIdx = u.i; drawLines(); paintStatus(); save(); } }, '↶ ត្រឡប់ការចុចចុងក្រោយ');
  const playerBox = h('div');
  const speedSel = h('select', { 'aria-label': 'ល្បឿនចាក់', style: { maxWidth: '190px' } }, ...[['0.5', '0.5× យឺតណាស់'], ['0.75', '0.75× យឺត'], ['1', '1× ធម្មតា']].map(([v, l]) => h('option', { value: v, selected: v === '1' }, l)));
  const applySpeed = () => { if (player) { player.audio.preservesPitch = true; player.audio.playbackRate = Number(speedSel.value); } };
  speedSel.addEventListener('change', applySpeed);
  function doTap() {
    if (!player) return;
    let i = nextIdx;
    if (i >= lines.length || i < 0) i = lines.findIndex((l) => l.start == null);
    if (i < 0) { toast('បានដាក់ពេលគ្រប់ឃ្លាហើយ — កែលម្អិតខាងក្រោម ឬបង្កើត MV', 'ok'); return; }
    undo.push({ i, prev: lines[i].start });
    lines[i].start = Math.round(player.time * 100) / 100;
    nextIdx = i + 1;
    if (navigator.vibrate) navigator.vibrate(12);
    drawLines(); paintStatus(); save();
    const row = linesBox.children[Math.min(nextIdx, lines.length - 1)]; if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  tapBtn.addEventListener('click', doTap);
  const onKey = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag) || document.querySelector('.overlay')) return;
    if (e.code === 'Space') { e.preventDefault(); doTap(); }
  };
  document.addEventListener('keydown', onKey); cleanups.push(() => document.removeEventListener('keydown', onKey));
  function paintStatus() {
    const timed = lines.filter((l) => l.start != null).length;
    const i = nextIdx < lines.length ? nextIdx : lines.findIndex((l) => l.start == null);
    tapBtn.textContent = i >= 0 && i < lines.length ? `👆 ចុច ពេលចាប់ផ្ដើមឃ្លាទី ${i + 1}` : '✓ បានដាក់ពេលគ្រប់ឃ្លា';
    tapBtn.disabled = !lines.length;
    status.replaceChildren(h('strong', null, `${timed}/${lines.length}`), ' ឃ្លាបានកំណត់ពេល', i >= 0 && i < lines.length ? h('span', null, ' · បន្ទាប់៖ ', h('span', { class: 'muted' }, `«${lines[i].text}»`)) : null);
    undoBtn.disabled = !undo.length;
  }

  // -------------------------- lines list --------------------------
  const linesBox = h('div', { class: 'stack' });
  function setStart(i, t) { lines[i].start = t === null ? null : Math.max(0, Math.round(t * 100) / 100); drawLines(); paintStatus(); save(); }
  function drawLines() {
    clear(linesBox);
    lines.forEach((l, i) => {
      const prev = lines.slice(0, i).reverse().find((x) => x.start != null);
      const outOfOrder = l.start != null && prev && l.start < prev.start;
      const time = h('input', { class: 'time', type: 'text', inputmode: 'decimal', value: l.start == null ? '' : fmtTime(l.start, 2), placeholder: '--:--', 'aria-label': `ពេលឃ្លាទី ${i + 1}` });
      time.addEventListener('change', () => { const t = time.value.trim() === '' ? null : parseTime(time.value); if (time.value.trim() !== '' && t === null) { toast('ទម្រង់ពេលមិនត្រឹមត្រូវ — ឧ. 1:23.5', 'warn'); time.value = l.start == null ? '' : fmtTime(l.start, 2); return; } setStart(i, t); });
      const btn = (label, title, fn, cls = '') => h('button', { class: `sm icon ${cls}`, type: 'button', title, 'aria-label': title, onClick: fn }, label);
      linesBox.append(h('div', { class: `linerow ${i === nextIdx ? 'next' : ''}`, dataset: { i } },
        h('div', { class: 'no' }, i + 1), h('div', null, h('div', { class: 'txt' }, l.text), outOfOrder ? h('div', { class: 'small', style: { color: 'var(--warn)' } }, '⚠ ពេលមុនឃ្លាមុន — ពិនិត្យលំដាប់') : null),
        h('div', { class: 'tools' }, time,
          btn('−', 'មុន 0.1 វិនាទី', () => l.start != null && setStart(i, l.start - 0.1)), btn('+', 'យឺត 0.1 វិនាទី', () => l.start != null && setStart(i, l.start + 0.1)),
          btn('⏱', 'កំណត់ជាពេលបច្ចុប្បន្ន', () => setStart(i, player.time)),
          btn('▶', 'ចាក់ពីមុនឃ្លានេះបន្តិច', () => { if (l.start != null) { player.seek(Math.max(0, l.start - 1.5)); player.play(); } }, ''),
          btn('🔁', 'ចាក់ឃ្លានេះម្ដងហើយម្ដងទៀត (ស្ដាប់ផ្ទៀងផ្ទាត់ពាក្យ)', () => { if (l.start == null) return; loopIdx = loopIdx === i ? null : i; if (loopIdx !== null) { player.seek(Math.max(0, l.start - 0.2)); player.play(); } drawLines(); }, loopIdx === i ? 'primary' : ''),
          btn('🎯', 'ឱ្យឃ្លានេះជាឃ្លាបន្ទាប់ដែលត្រូវចុច', () => { nextIdx = i; drawLines(); paintStatus(); }),
          btn('✕', 'សម្អាតពេល', () => setStart(i, null), 'danger'))));
    });
    paintPreview();
  }

  // -------------------------- live preview (HTML approximation; the real frame button shows libass) --------------------------
  const stage = h('div', { class: 'stage' }); const stageLines = h('div', { class: 'lines' }); stage.append(stageLines);
  const resSel = h('select', { 'aria-label': 'ទំហំវីដេអូ' }, ...state.health.resolutions.map((r) => h('option', { value: r, selected: r === '1920x1080' }, RES_LABEL[r] || r)));
  const bgSel = h('select', { 'aria-label': 'ផ្ទៃខាងក្រោយ' });
  function fillBackgrounds() {
    clear(bgSel);
    bgSel.append(h('option', { value: 'auto' }, 'ស្វ័យប្រវត្តិ (ប្រើរូបគម្របដែលជ្រើសសម្រាប់ MV)'), h('option', { value: 'none' }, 'គ្មានរូប (ពណ៌ចម្រុះស្រាប់)'));
    Object.entries(p.cover.files).forEach(([a, e]) => { [e.plain, e.file].filter(Boolean).forEach((f) => bgSel.append(h('option', { value: f }, `${a} · ${f === e.plain ? 'គ្មានអក្សរ' : 'មានអក្សរ'}`))); });
  }
  function bgUrl() {
    const choice = bgSel.value; const [w, hh] = resSel.value.split('x').map(Number);
    if (choice === 'none') return null;
    if (choice !== 'auto') return `/media/${pid}/covers/${choice}`;
    const wanted = w > hh ? '16:9' : '9:16'; const entry = p.cover.files[wanted];
    if (p.cover.mv_background) return `/media/${pid}/covers/${p.cover.mv_background}`;
    return entry ? `/media/${pid}/covers/${entry.plain || entry.file}` : null;
  }
  function paintStage() {
    const portrait = resSel.value.split('x').map(Number).reduce((a, b) => a < b);
    stage.classList.toggle('portrait', !!portrait);
    const u = bgUrl();
    stage.style.backgroundImage = u ? `url("${u}")` : 'linear-gradient(#0a1252,#4a1e80 55%,#b03848)';
    stage.style.setProperty('--fs', `${Math.max(14, stage.clientWidth * 0.05 * (style.size / 84))}px`);
    stageLines.style.color = '#fff';
  }
  function curIndex(t) { let c = -1; lines.forEach((l, i) => { if (l.start != null && l.start <= t + 0.02) c = i; }); return c; }
  function paintPreview() {
    if (!player) return;
    paintStage();
    const t = player.time; const c = curIndex(t);
    clear(stageLines);
    const mk = (i, cur) => (i >= 0 && i < lines.length) ? h('div', { class: `l ${cur ? 'cur' : ''}`, style: cur ? { color: style.color } : {} }, lines[i].text) : null;
    stageLines.append(mk(c - 1, false), mk(c, true) || h('div', { class: 'l', style: { opacity: .8 } }, p.title || '♪'), mk(c + 1, false));
    document.querySelectorAll('.linerow').forEach((el, i) => el.classList.toggle('now', i === c));
  }
  function loopEnd(i) {
    const start = lines[i].start;
    const nxt = lines.map((l) => l.start).filter((t) => t != null && t > start + 0.3).sort((a, b) => a - b)[0];
    return nxt != null ? nxt : start + 6;
  }
  function startLoop() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (loopIdx !== null && lines[loopIdx] && lines[loopIdx].start != null && player && !player.audio.paused && player.time >= loopEnd(loopIdx)) player.seek(Math.max(0, lines[loopIdx].start - 0.2));
      paintPreview();
      if (player && !player.audio.paused) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }
  resSel.addEventListener('change', paintPreview); bgSel.addEventListener('change', paintPreview);

  // -------------------------- style --------------------------
  const fontSel = h('select', null, ...presets.fonts.map((f) => h('option', { value: f, selected: f === style.font }, f)));
  const sizeIn = h('input', { type: 'range', min: 48, max: 160, step: 2, value: style.size });
  const colorIn = h('input', { type: 'color', value: style.color });
  const dimIn = h('input', { type: 'range', min: 0, max: 0.7, step: 0.02, value: style.dim_background });
  const boxIn = h('input', { type: 'checkbox', checked: !!style.text_box });
  const trimIn = h('input', { type: 'checkbox', checked: style.trim_silence !== false });
  const barIn = h('input', { type: 'checkbox', checked: !!style.progress_bar }); const titleIn = h('input', { type: 'checkbox', checked: !!style.show_title });
  const styleChanged = () => { style = { ...style, font: fontSel.value, size: Number(sizeIn.value), color: colorIn.value, dim_background: Number(dimIn.value), progress_bar: barIn.checked, show_title: titleIn.checked, text_box: boxIn.checked, trim_silence: trimIn.checked }; paintPreview(); save(); };
  [fontSel, sizeIn, colorIn, dimIn, barIn, titleIn, boxIn, trimIn].forEach((el) => el.addEventListener('input', styleChanged));

  // -------------------------- render + outputs --------------------------
  const mvCard = makeJobCard({ onSuccess: async () => { setProject(p = await api.get(`/api/projects/${pid}`)); drawOutputs(); toast('MV ខារ៉ាអូខេរួចរាល់ ✓', 'ok'); } });
  const outputs = h('div', { class: 'stack mvlist' });
  function missing() { return lines.map((l, i) => (l.start == null ? i + 1 : null)).filter(Boolean); }
  async function render(resolution) {
    const m = missing();
    if (m.length) { toast(`នៅមានឃ្លា ${m.length} ដែលមិនទាន់កំណត់ពេល (ឃ្លាទី ${m.slice(0, 6).join(', ')}${m.length > 6 ? '…' : ''})`, 'warn', 6000); const row = linesBox.children[m[0] - 1]; row && row.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    try {
      await save.flush();
      mvCard.clear();
      const job = await api.post(`/api/projects/${pid}/karaoke/render`, { resolution, background: bgSel.value, style, lines, version_id: versionId });
      trackJob(job, (j) => mvCard.set(j)); mvCard.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { toast(errorText(e), 'bad', 7000); }
  }
  async function realFrame() {
    const t = player ? player.time : 0; const c = curIndex(t);
    const at = c >= 0 ? t : (lines.find((l) => l.start != null) || { start: 1 }).start + 0.5;
    const t0 = toast('កំពុងបង្កើតស៊ុមពិត (ដូច MP4)…', 'info', 0);
    try {
      const blob = await api.blobPost(`/api/projects/${pid}/karaoke/frame`, { resolution: resSel.value, background: bgSel.value, style, lines, version_id: versionId, at });
      const url = URL.createObjectURL(blob);
      modal({ title: 'ស៊ុមពិត — ដូចអ្វីដែលនឹងនៅក្នុង MP4', body: h('div', { class: 'stack' }, h('img', { src: url, style: { width: '100%', borderRadius: '10px', maxHeight: '70vh', objectFit: 'contain', background: '#000' } }), h('div', { class: 'small muted' }, `ម៉ោង ${fmtTime(at)} · អក្សរត្រូវបានគូរដោយ libass/HarfBuzz ដូច្នេះស្រៈ និងជើងអក្សរខ្មែរត្រឹមត្រូវ`)), actions: [{ label: 'បិទ', class: 'primary' }], wide: true });
    } catch (e) { toast(errorText(e), 'bad', 7000); } finally { t0.close(); }
  }
  function drawOutputs() {
    clear(outputs);
    if (!p.karaoke.outputs.length) { outputs.append(h('div', { class: 'muted small' }, 'មិនទាន់មាន MV ទេ។')); return; }
    [...p.karaoke.outputs].reverse().forEach((o) => {
      const portrait = o.resolution === '1080x1920';
      outputs.append(h('div', { class: 'card flat stack' },
        h('div', { class: 'row spread' }, h('div', { class: 'row' }, h('strong', null, RES_LABEL[o.resolution] || o.resolution), badge(o.version_label || '')), h('span', { class: 'small muted' }, fmtDuration(o.duration), ' · ', fmtBytes(o.size), ' · ', fmtDate(o.created_at))),
        h('video', { controls: true, playsinline: true, preload: 'metadata', src: `/media/${pid}/mv/${o.id}.mp4`, style: portrait ? { maxHeight: '60vh', width: 'auto', margin: '0 auto' } : {} }),
        h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `/api/projects/${pid}/mv/${o.id}/download`, download: '' }, '⬇ ទាញយក MP4'),
          h('button', { class: 'sm danger', type: 'button', onClick: async () => { if (await confirmDialog('លុបវីដេអូនេះ?', { ok: 'លុប', danger: true })) { try { setProject(p = await api.del(`/api/projects/${pid}/mv/${o.id}`)); drawOutputs(); } catch (e) { toast(errorText(e), 'bad'); } } } }, '🗑 លុប'))));
    });
  }

  // -------------------------- layout --------------------------
  fillVersions(); fillBackgrounds();
  root.append(h('div', { class: 'stack' },
    h('div', { class: 'note' }, 'ស្ដាប់បទ ហើយចុចប៊ូតុងធំរាល់ពេលដែលឃ្លាថ្មីចាប់ផ្ដើមច្រៀង។ កម្មវិធីនឹងកត់ពេលនោះ។ ប្រសិនបើពាក្យដែលឮមិនត្រូវនឹងទំនុកដើម អ្នកនឹងដឹងភ្លាមពេលចុច — នោះជាវិធីផ្ទៀងផ្ទាត់។ (កុំព្យូទ័រ៖ ចុចគ្រាប់ចុច ', h('span', { class: 'kbd' }, 'Space'), ')'),
    h('section', { class: 'card stack' }, h('h3', null, '១) ជ្រើសបទ និងទំនុកសម្រាប់ MV'),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'កំណែបទ'), versionSel),
      h('label', { class: 'check' }, useCurrentBox, h('span', null, 'ប្រើទំនុកបច្ចុប្បន្នរបស់គម្រោង (ជំនួសទំនុកដែលបានប្រើពេលបង្កើតកំណែនោះ)')),
      h('div', { class: 'small muted' }, 'តាមលំនាំដើម MV ប្រើទំនុកដែលបានប្រើពេលបង្កើតកំណែបទនោះ — ដូច្នេះ Chorus សាកល្បងមានតែ ៤ បន្ទាត់របស់វា។')),
    h('section', { class: 'card stack' }, h('h3', null, '២) កំណត់ពេលចាប់ផ្ដើមឃ្លា'), playerBox,
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ល្បឿនចាក់៖'), speedSel, h('span', { class: 'small muted' }, 'ចាក់យឺត ដើម្បីស្ដាប់ពាក្យច្បាស់ — ពេលដែលកត់ត្រូវនៅត្រឹមត្រូវ')),
      h('div', { class: 'tapbar' }, tapBtn, h('div', { class: 'row spread' }, status, undoBtn)), linesBox, saveState),
    h('section', { class: 'card stack' }, h('h3', null, '៣) មើលសាកល្បង'), stage,
      h('div', { class: 'row' }, h('button', { type: 'button', onClick: realFrame }, '👁 មើលស៊ុមពិត (ដូច MP4)')),
      h('div', { class: 'small muted' }, 'ការមើលផ្ទាល់ខាងលើជាគំរូប៉ុណ្ណោះ។ «ស៊ុមពិត» ប្រើ FFmpeg+libass ដូច MP4 ដែលនឹងចេញ។')),
    h('section', { class: 'card stack' }, h('h3', null, '៤) រចនាប័ទ្ម'),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ទំហំ/ប្រភេទវីដេអូ (សម្រាប់មើល)'), resSel), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ផ្ទៃខាងក្រោយ'), bgSel),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ពុម្ពអក្សរ'), fontSel), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ទំហំអក្សរ'), sizeIn),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ពណ៌ឃ្លាបន្លិច'), colorIn), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ងងឹតផ្ទៃខាងក្រោយ'), dimIn)),
      h('div', { class: 'row' }, h('label', { class: 'check' }, barIn, 'របារវឌ្ឍនភាព'), h('label', { class: 'check' }, titleIn, 'បង្ហាញចំណងជើង/សិល្បករ'), h('label', { class: 'check' }, boxIn, 'ប្រអប់ងងឹតក្រោយអក្សរ (អានងាយលើរូបភ្លឺ)'), h('label', { class: 'check' }, trimIn, 'កាត់ផ្នែកស្ងាត់ចុងបទ'))),
    h('section', { class: 'card stack' }, h('h3', null, '៥) បង្កើត MV (MP4 · FFmpeg)'),
      h('div', { class: 'row' },
        h('button', { class: 'primary big grow', type: 'button', onClick: () => render('1920x1080') }, '🎬 YouTube 1920×1080'),
        h('button', { class: 'violet big grow', type: 'button', onClick: () => render('1080x1920') }, '📱 Shorts 1080×1920'),
        h('button', { type: 'button', onClick: () => render('1280x720') }, 'សាកល្បងលឿន 1280×720')),
      mvCard.el, h('h4', null, 'វីដេអូដែលបានបង្កើត'), outputs,
      h('div', null, h('a', { class: 'btn primary', href: `#/p/${pid}/publish` }, 'បន្ទាប់៖ រៀបចំបង្ហោះ →')))));
  drawOutputs();
  await loadVersion(versionId);
  window.addEventListener('resize', paintPreview); cleanups.push(() => window.removeEventListener('resize', paintPreview));
  try {
    const { jobs } = await api.get(`/api/projects/${pid}/jobs`);
    const m = jobs.find((j) => j.kind === 'mv');
    if (m && isActive(m)) trackJob(m, (j) => mvCard.set(j)); else if (m && (m.status === 'failed')) mvCard.set(m);
  } catch { /* ignore */ }

  return async () => { await save.flush(); cancelAnimationFrame(raf); if (player) player.destroy(); cleanups.forEach((f) => f()); };
}
