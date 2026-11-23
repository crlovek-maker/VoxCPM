// Panel 2 — make the song: engine, description (style/instruments), native model controls,
// short chorus test, versions (listen / compare / download / pick for MV), and "mix my own voice".
import { api, errorText } from '../api.js';
import { state, setProject, engineInfo, refreshHealth } from '../state.js';
import { createPlayer } from '../player.js';
import { trackJob, makeJobCard, isActive } from '../jobs.js';
import { micStatus, startRecording, extFor } from '../recorder.js';
import { engineCard } from './engine_info.js';
import { h, clear, toast, modal, confirmDialog, debounce, badge, fmtDuration, fmtDate, spinner } from '../ui.js';

const KIND_LABEL = { full: 'បទពេញ', chorus_test: 'Chorus សាកល្បង', mix: 'ភ្លេង + សំឡេងខ្ញុំ', upload: 'ឯកសារនាំចូល' };

export async function renderMusic(root, { project, pid }) {
  let p = project;
  const presets = state.presets;
  let music = { ...p.music };
  const players = [];
  const quickPlayers = [];
  const cleanups = [];
  const health = state.health;
  const engines = health.engines;
  if (!music.engine || !engines.some((e) => e.id === music.engine)) music.engine = health.default_engine;
  const lineCount = () => p.lyrics.sections.reduce((n, s) => n + s.lines.filter((l) => l.trim()).length, 0);
  const suggest = (purpose) => purpose === 'chorus_test' ? Math.max(20, Math.min(45, 8 + 5 * Math.max(lineCount(), 1))) : Math.max(30, Math.min(240, 15 + 5 * Math.max(lineCount(), 1)));
  const refreshProject = async () => { p = await api.get(`/api/projects/${pid}`); setProject(p); return p; };

  const persist = debounce(async () => { try { await api.patch(`/api/projects/${pid}`, { music }); } catch { /* shown on generate */ } }, 600);
  const changed = () => { persist(); paintCaption(); };

  // ======================= 1. engine ===========================
  const engineBox = h('div', { class: 'stack' });
  const nativeBox = h('div');
  function drawEngines() {
    clear(engineBox);
    for (const e of engines) {
      const on = music.engine === e.id;
      engineBox.append(h('div', { class: 'card flat', style: on ? { borderColor: 'var(--accent)' } : {} },
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'engine', checked: on, onChange: () => { music.engine = e.id; changed(); drawEngines(); drawNative(); drawActions(); } }),
          h('div', { class: 'grow' }, h('strong', null, e.name), ' ', e.is_ai ? badge('AI', 'ai') : badge('មិនមែន AI', 'notai'), ' ', badge(e.health.ok ? 'ភ្ជាប់បាន' : 'មិនទាន់ភ្ជាប់', e.health.ok ? 'ok' : 'bad'),
            h('div', { class: 'small muted' }, e.summary))),
        on ? engineCard(e, { open: !e.health.ok }) : null));
    }
  }

  // ======================= 2. mode + description ===========================
  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'របៀប' });
  function drawMode() {
    clear(modeSeg);
    const info = engineInfo(music.engine);
    [['vocals', '🎤 ភ្លេងជាមួយសំឡេងច្រៀង'], ['instrumental', '🎼 ភ្លេងសុទ្ធ']].forEach(([v, label]) => {
      const disabled = v === 'instrumental' && info && !info.supports_instrumental;
      modeSeg.append(h('button', { type: 'button', class: music.mode === v ? 'on' : '', disabled, onClick: () => { music.mode = v; changed(); drawMode(); drawActions(); } }, label));
    });
  }
  const chipGroup = (key, items, { single = false } = {}) => {
    const wrap = h('div', { class: 'chips' });
    const draw = () => {
      clear(wrap);
      const cur = music[key] || [];
      items.forEach((it) => {
        const on = cur.includes(it.id);
        wrap.append(h('button', { type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': on ? 'true' : 'false', title: it.en, onClick: () => {
          let next = on ? cur.filter((x) => x !== it.id) : (single ? [it.id] : [...cur, it.id]);
          music[key] = next; changed(); draw();
        } }, it.km));
      });
    };
    draw();
    return wrap;
  };
  const extra = h('input', { type: 'text', placeholder: 'ពាក្យពិពណ៌នាបន្ថែមជាអង់គ្លេស (ជម្រើស) ឧ. slow tempo, warm reverb', value: music.extra || '', maxlength: 200 });
  extra.addEventListener('input', () => { music.extra = extra.value; changed(); });
  const captionBox = h('div', { class: 'small mono muted' });
  const paintCaption = debounce(async () => {
    try {
      const r = await api.post('/api/caption', { music, instrumental: music.mode === 'instrumental' });
      captionBox.textContent = r.caption || '(គ្មាន)';
      captionBox.className = 'small mono ' + (r.length > r.limit ? 'bad' : 'muted');
      captionLen.textContent = `${r.length}/${r.limit}`;
    } catch { /* ignore */ }
  }, 300);
  const captionLen = h('span', { class: 'badge' });

  // ======================= 3. native controls ===========================
  function drawNative() {
    clear(nativeBox);
    const info = engineInfo(music.engine);
    if (!info) return;
    const grid = h('div', { class: 'grid2' });
    for (const c of info.native_controls) {
      let input;
      if (c.type === 'select') {
        input = h('select', null, ...c.options.map((o) => h('option', { value: o.value, selected: String(music[c.key] ?? c.default ?? '') === String(o.value) }, o.label)));
        input.addEventListener('change', () => { music[c.key] = input.value; changed(); });
      } else {
        const ph = c.key === 'duration' ? `ស្វ័យប្រវត្តិ ≈ ${suggest('full')}` : (c.default != null ? `ដើម ${c.default}` : 'ស្វ័យប្រវត្តិ');
        input = h('input', { type: 'number', min: c.min, max: c.max, step: c.step || 1, placeholder: ph, value: music[c.key] ?? '', inputmode: 'numeric' });
        input.addEventListener('input', () => { music[c.key] = input.value === '' ? null : Number(input.value); changed(); });
      }
      grid.append(h('label', { class: 'field' }, h('span', { class: 'lbl' }, c.label, badge('ម៉ូដែលគាំទ្រផ្ទាល់', 'native')), input, c.note ? h('span', { class: 'small muted' }, c.note) : null));
    }
    nativeBox.append(grid);
    // The 5Hz language-model planner exists only if the server was started with it (GPU with enough VRAM).
    if (info.id === 'acestep' && info.health.detail && info.health.detail.llm_initialized) {
      const lm = h('input', { type: 'checkbox', checked: !!music.use_lm });
      lm.addEventListener('change', () => { music.use_lm = lm.checked; changed(); });
      nativeBox.append(h('label', { class: 'check' }, lm, h('span', null, 'ប្រើ LM ផែនការរបស់ម៉ូដែល (thinking) ', badge('ម៉ូដែលគាំទ្រផ្ទាល់', 'native'),
        h('div', { class: 'small muted' }, 'ឯកសារណែនាំសម្រាប់គុណភាពល្អជាង តែយឺតជាង និងប្រើ VRAM ច្រើនជាង។ ប្រសិនបើច្រៀងខ្មែរមិនច្បាស់ សាកល្បងបើក/បិទ ដើម្បីប្រៀបធៀប។'))));
    }
  }

  // ======================= 4. generate + job ===========================
  const genCard = makeJobCard({
    onRetry: (job) => startGeneration(job.params && job.params.mode === 'chorus_test' ? 'chorus_test' : 'full'),
    onSuccess: async (job, extraBox, opts = {}) => {
      await refreshProject();
      drawVersions();
      const v = p.versions.find((x) => x.id === job.result.version_id);
      clear(extraBox);
      if (v) {
        extraBox.append(h('div', { class: 'note ok' }, h('strong', null, '✓ រួចរាល់ — ស្ដាប់ និងទាញយកបានភ្លាម៖'), (job.result.warnings || []).map((w) => h('div', { class: 'note warn' }, '⚠ ' + w)),
          (job.result.notes || []).map((n) => h('div', { class: 'small muted' }, '• ' + n))), versionCard(v, { quick: true }));
      }
      if (!opts.restored) toast('បទថ្មីរួចរាល់ ✓', 'ok'); // no toast when we merely re-show the last result after a page reload
    },
  });
  const actions = h('div', { class: 'stack' });
  const chorusDur = h('input', { type: 'number', min: 10, max: 120, step: 1, value: music.chorus_duration ?? '', placeholder: `≈ ${suggest('chorus_test')}`, style: { width: '90px' }, 'aria-label': 'រយៈពេល Chorus សាកល្បង', inputmode: 'numeric' });
  chorusDur.addEventListener('input', () => { music.chorus_duration = chorusDur.value === '' ? null : Number(chorusDur.value); changed(); });
  let busy = false;

  async function startGeneration(mode) {
    if (busy) return; busy = true;
    const instrumental = music.mode === 'instrumental';
    if (!instrumental && lineCount() === 0) { busy = false; toast('សូមបញ្ចូលទំនុកក្នុងផ្ទាំង «ទំនុក» ជាមុន (ឬជ្រើស «ភ្លេងសុទ្ធ»)', 'warn'); return; }
    try {
      await persist.flush();
      genCard.clear(); // do not keep showing the previous run while the new one is being queued
      const job = await api.post(`/api/projects/${pid}/generate`, { mode, engine: music.engine, instrumental, music });
      trackJob(job, (j) => genCard.set(j));
      genCard.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) { toast(errorText(e), 'bad', 7000); } finally { busy = false; }
  }
  function drawActions() {
    clear(actions);
    const info = engineInfo(music.engine);
    const ready = info && info.health.ok;
    const instrumental = music.mode === 'instrumental';
    actions.append(
      !ready ? h('div', { class: 'note warn' }, h('strong', null, 'ម៉ូដែលមិនទាន់ភ្ជាប់: '), info ? info.health.message : '', '។ ប៊ូតុងខាងក្រោមនឹងបរាជ័យដោយបង្ហាញមូលហេតុពិត។ ចុចស្ថានភាពម៉ូដែលនៅខាងលើដើម្បីមើលវិធីដំឡើង។', h('div', null, h('button', { class: 'sm', type: 'button', onClick: async () => { await refreshHealth(true); location.reload(); } }, '↻ ពិនិត្យម្ដងទៀត'))) : null,
      h('div', { class: 'row' },
        h('button', { class: 'primary big grow', type: 'button', onClick: () => startGeneration('full') }, instrumental ? '🎼 បង្កើតភ្លេងសុទ្ធ' : '🎵 បង្កើតបទចម្រៀង')),
      !instrumental ? h('div', { class: 'row' },
        h('button', { class: 'violet', type: 'button', onClick: () => startGeneration('chorus_test') }, '🔊 សាកល្បង Chorus ខ្លី'),
        h('span', { class: 'small muted' }, 'រយៈពេល (វិនាទី):'), chorusDur,
        h('span', { class: 'small muted grow' }, 'ស្ដាប់ការបញ្ចេញពាក្យខ្មែរមុនបង្កើតបទពេញ — ប្រើតែ Chorus (ឬផ្នែកទីមួយ) ក្នុងទំនុក')) : null);
  }

  // ======================= 5. versions ===========================
  const versionsBox = h('div', { class: 'stack' });
  const compareBar = h('div');
  const compare = [];
  const playerOf = new Map();

  function versionCard(v, { quick = false } = {}) {
    const pl = createPlayer(`/media/${pid}/audio/${v.id}.wav`);
    (quick ? quickPlayers : players).push(pl);
    if (!quick) playerOf.set(v.id, pl);
    const sel = p.selected_version_id === v.id;
    const dl = (fmt) => h('a', { class: 'btn sm', href: `/api/projects/${pid}/versions/${v.id}/download?format=${fmt}`, download: '' }, `⬇ ${fmt.toUpperCase()}`);
    const name = h('strong', { style: { cursor: 'pointer' }, title: 'ចុចដើម្បីប្ដូរឈ្មោះ', onClick: () => rename(v) }, v.label || v.id);
    const warn = (v.warnings || []).map((w) => h('div', { class: 'note warn small' }, '⚠ ' + w));
    const cmpId = `c_${v.id}_${quick ? 'q' : 'l'}`;
    return h('div', { class: `card version ${sel ? 'selected' : ''}`, id: quick ? null : `v_${v.id}` },
      h('div', { class: 'row spread' }, h('div', { class: 'row' }, name, badge(KIND_LABEL[v.kind] || v.kind), v.instrumental ? badge('ភ្លេងសុទ្ធ') : null,
        v.engine.is_ai ? badge('AI · ' + v.engine.name, 'ai') : badge(v.engine.name, 'notai')), h('span', { class: 'small muted' }, fmtDuration(v.duration), ' · ', fmtDate(v.created_at))),
      ...warn, pl.el,
      h('div', { class: 'row' }, dl('wav'), dl('mp3'),
        h('button', { class: `sm ${sel ? 'primary' : ''}`, type: 'button', disabled: v.instrumental, title: v.instrumental ? 'ភ្លេងសុទ្ធមិនអាចជា MV ដោយគ្មានសំឡេង' : '', onClick: async () => { try { setProject(p = await api.post(`/api/projects/${pid}/select-version`, { version_id: v.id })); drawVersions(); toast('បានជ្រើសកំណែនេះសម្រាប់ MV ✓', 'ok'); } catch (e) { toast(errorText(e), 'bad'); } } }, sel ? '✓ ប្រើក្នុង MV' : 'ជ្រើសសម្រាប់ MV'),
        quick ? null : h('label', { class: 'check', style: { padding: 0 } }, h('input', { type: 'checkbox', id: cmpId, checked: compare.includes(v.id), onChange: (ev) => toggleCompare(v.id, ev.target.checked) }), 'ប្រៀបធៀប'),
        quick ? null : h('button', { class: 'sm danger', type: 'button', onClick: () => removeVersion(v) }, '🗑')),
      h('details', null, h('summary', null, 'ព័ត៌មានលម្អិតនៃកំណែនេះ'),
        h('div', { class: 'small stack' },
          v.caption ? h('div', null, h('strong', null, 'ការពិពណ៌នា (caption) ដែលបានផ្ញើ: '), v.caption) : null,
          v.seed != null ? h('div', null, h('strong', null, 'Seed: '), v.seed) : null,
          h('div', null, h('strong', null, 'ទំនុកដែលបានប្រើ: '), h('div', { class: 'muted' }, (v.lyrics_snapshot || []).flatMap((s) => s.lines).filter(Boolean).join(' / ') || '—')),
          v.analysis ? h('div', null, h('strong', null, 'ការវិភាគសំឡេង: '), `កម្រិតមធ្យម ${v.analysis.mean_db} dB · ស្ងាត់ដើម ${v.analysis.leading_silence}s · ស្ងាត់សរុប ${v.analysis.silent_seconds}s`) : null,
          h('div', { class: 'mono muted' }, JSON.stringify(v.request, null, 1).slice(0, 900)))));
  }

  async function rename(v) {
    const input = h('input', { type: 'text', value: v.label || '', maxlength: 80 });
    modal({ title: 'ប្ដូរឈ្មោះកំណែ', body: input, actions: [{ label: 'បោះបង់' }, { label: 'រក្សាទុក', class: 'primary', onClick: async () => {
      try { setProject(p = await api.patch(`/api/projects/${pid}/versions/${v.id}`, { label: input.value })); drawVersions(); } catch (e) { toast(errorText(e), 'bad'); return false; }
    } }] });
    setTimeout(() => input.select(), 50);
  }
  async function removeVersion(v) {
    if (!(await confirmDialog(`លុបកំណែ «${v.label}»? ឯកសារសំឡេងនឹងបាត់។`, { ok: 'លុប', danger: true }))) return;
    try { setProject(p = await api.del(`/api/projects/${pid}/versions/${v.id}`)); drawVersions(); } catch (e) { toast(errorText(e), 'bad'); }
  }
  function toggleCompare(id, on) {
    const i = compare.indexOf(id);
    if (on && i < 0) compare.push(id);
    if (!on && i >= 0) compare.splice(i, 1);
    while (compare.length > 2) compare.shift();
    drawCompare();
    document.querySelectorAll('[id^="c_"]').forEach((el) => { const vid = el.id.split('_').slice(1, -1).join('_'); el.checked = compare.includes(vid); });
  }
  function drawCompare() {
    clear(compareBar);
    if (compare.length !== 2) return;
    const [a, b] = compare.map((id) => p.versions.find((v) => v.id === id));
    if (!a || !b) return;
    const A = playerOf.get(a.id); const B = playerOf.get(b.id);
    compareBar.append(h('div', { class: 'card', style: { borderColor: 'var(--violet)' } },
      h('div', { class: 'row spread' }, h('div', null, h('strong', null, 'ប្រៀបធៀប A/B: '), h('span', { class: 'badge' }, 'A'), ' ', a.label, '  ↔  ', h('span', { class: 'badge' }, 'B'), ' ', b.label),
        h('button', { class: 'violet', type: 'button', onClick: () => {
          const playingA = !A.audio.paused; const from = playingA ? A : (!B.audio.paused ? B : A); const to = from === A ? B : A;
          const t = from.time; from.pause(); to.seek(Math.min(t, to.duration || t)); to.play();
        } }, '⇄ ប្ដូរ A ↔ B (ទីតាំងដដែល)')),
      h('div', { class: 'small muted' }, 'ចុចចាក់នៅកំណែណាមួយ រួចចុចប៊ូតុងនេះដើម្បីប្ដូរទៅកំណែមួយទៀតត្រង់ពេលដដែល។')));
  }
  function drawVersions() {
    players.splice(0).forEach((pl) => pl.destroy()); playerOf.clear();
    clear(versionsBox);
    const list = [...p.versions].reverse();
    if (!list.length) versionsBox.append(h('div', { class: 'card center muted' }, 'មិនទាន់មានកំណែបទទេ — ចុច «បង្កើតបទចម្រៀង» ឬ «សាកល្បង Chorus ខ្លី» ខាងលើ។'));
    for (const v of list) versionsBox.append(versionCard(v));
    drawCompare(); drawMixSources();
  }

  // ======================= 6. own voice + mix ===========================
  const mixBox = h('div', { class: 'stack' });
  const mixCard = makeJobCard({ onSuccess: async () => { await refreshProject(); drawVersions(); toast('បានរក្សាទុកកំណែលាយសំឡេងថ្មី ✓ (ត្រូវបានជ្រើសសម្រាប់ MV)', 'ok'); } });
  const instSel = h('select', { 'aria-label': 'ភ្លេងសុទ្ធ' });
  const voiceSel = h('select', { 'aria-label': 'សំឡេងដែលបានថត' });
  const musicDb = h('input', { type: 'range', min: -24, max: 6, step: 0.5, value: -3 });
  const voiceDb = h('input', { type: 'range', min: -12, max: 12, step: 0.5, value: 0 });
  const offsetS = h('input', { type: 'range', min: -1, max: 2, step: 0.05, value: 0 });
  const mdbOut = h('strong'); const vdbOut = h('strong'); const offOut = h('strong');
  const previewBox = h('div');
  const recBtn = h('button', { class: 'primary', type: 'button' }, '🎙 ថតសំឡេងច្រៀងតាមភ្លេង');
  const recStatus = h('span', { class: 'small muted' });
  const mixButtons = h('div', { class: 'row' });
  let rec = null; let recAudio = null; let recTick = null; let recStartDelta = 0;

  const paintSliders = () => { mdbOut.textContent = `${musicDb.value} dB`; vdbOut.textContent = `${voiceDb.value} dB`; offOut.textContent = `${Number(offsetS.value).toFixed(2)} វិនាទី`; };
  [musicDb, voiceDb, offsetS].forEach((r) => r.addEventListener('input', paintSliders));

  function drawMixSources() {
    const prevI = instSel.value; const prevV = voiceSel.value;
    clear(instSel); clear(voiceSel);
    const insts = p.versions.filter((v) => v.instrumental);
    insts.forEach((v) => instSel.append(h('option', { value: v.id }, `${v.label} (${fmtDuration(v.duration)})`)));
    if (insts.some((v) => v.id === prevI)) instSel.value = prevI;
    p.voice_recordings.forEach((r) => voiceSel.append(h('option', { value: r.id }, `${r.label} (${fmtDuration(r.duration)})`)));
    if (p.voice_recordings.some((r) => r.id === prevV)) voiceSel.value = prevV;
    const ready = insts.length && p.voice_recordings.length;
    mixButtons.querySelectorAll('button').forEach((b) => { b.disabled = !ready; });
    drawVoiceList();
  }
  const voiceList = h('div', { class: 'stack' });
  function drawVoiceList() {
    clear(voiceList);
    p.voice_recordings.forEach((r) => {
      const pl = createPlayer(`/media/${pid}/voice/${r.id}.wav`); players.push(pl);
      voiceList.append(h('div', { class: 'row nowrap' }, h('div', { class: 'grow' }, h('div', { class: 'small' }, r.label, ' · ', fmtDuration(r.duration)), pl.el),
        h('button', { class: 'sm danger', type: 'button', onClick: async () => { try { setProject(p = await api.del(`/api/projects/${pid}/voice/${r.id}`)); drawMixSources(); } catch (e) { toast(errorText(e), 'bad'); } } }, '🗑')));
    });
  }
  async function uploadVoice(blob, filename, offset = 0) {
    const fd = new FormData(); fd.append('file', blob, filename); fd.append('label', `សំឡេងខ្ញុំ ${new Date().toLocaleTimeString()}`); fd.append('offset', String(offset));
    const t = toast('កំពុងបញ្ជូន និងបំលែងសំឡេង…', 'info', 0);
    try {
      const r = await api.upload(`/api/projects/${pid}/voice`, fd);
      await refreshProject(); drawMixSources(); voiceSel.value = r.id;
      offsetS.value = String(Math.min(2, r.offset || 0)); paintSliders();
      toast('បានរក្សាទុកសំឡេងរបស់អ្នក ✓', 'ok');
    } catch (e) { toast(errorText(e), 'bad', 7000); } finally { t.close(); }
  }
  recBtn.addEventListener('click', async () => {
    if (rec) {
      clearInterval(recTick); recAudio && recAudio.pause();
      const r = rec; rec = null; recBtn.textContent = '🎙 ថតសំឡេងច្រៀងតាមភ្លេង'; recBtn.classList.add('primary'); recStatus.textContent = '';
      const blob = await r.stop();
      await uploadVoice(blob, 'recording' + extFor(r.mime), recStartDelta);
      return;
    }
    const instId = instSel.value;
    if (!instId) { toast('សូមបង្កើតភ្លេងសុទ្ធជាមុន (ឬ upload ភ្លេង) ដើម្បីច្រៀងតាម', 'warn'); return; }
    recAudio = new Audio(`/media/${pid}/audio/${instId}.wav`);
    const playStart = performance.now();
    const playing = recAudio.play().catch(() => null); // started inside the click so iOS allows it
    try { rec = await startRecording(); } catch (e) { recAudio.pause(); toast('មិនអាចប្រើមីក្រូហ្វូន: ' + (e.message || e), 'bad', 7000); return; }
    recStartDelta = Math.max(0, (performance.now() - playStart) / 1000);
    await playing;
    recBtn.classList.remove('primary'); recBtn.replaceChildren(h('span', { class: 'rec-dot' }), ' ឈប់ថត');
    recTick = setInterval(() => { recStatus.textContent = `កំពុងថត ${fmtDuration(rec ? rec.elapsed() : 0)} — ប្រើកាស (headphones) ដើម្បីកុំឱ្យភ្លេងចូលមីក្រូ`; }, 300);
  });
  const fileIn = h('input', { type: 'file', accept: 'audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac', 'aria-label': 'upload សំឡេង' });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (f) { await uploadVoice(f, f.name, 0); fileIn.value = ''; } });
  const mix = () => ({ instrumental_version_id: instSel.value, voice_id: voiceSel.value, music_db: Number(musicDb.value), voice_db: Number(voiceDb.value), voice_offset: Number(offsetS.value) });
  mixButtons.append(
    h('button', { type: 'button', onClick: async () => {
      clear(previewBox); previewBox.append(h('div', { class: 'row' }, spinner(), 'កំពុងលាយសាកល្បង…'));
      try {
        const r = await api.post(`/api/projects/${pid}/mix/preview`, { ...mix(), seconds: 30 });
        clear(previewBox); const pl = createPlayer(r.url); players.push(pl); previewBox.append(h('div', { class: 'small muted' }, 'សាកល្បង ៣០ វិនាទីដំបូង៖'), pl.el); pl.play();
      } catch (e) { clear(previewBox); previewBox.append(h('div', { class: 'note bad' }, errorText(e))); }
    } }, '▶ ស្ដាប់សាកល្បង (៣០ វិនាទី)'),
    h('button', { class: 'primary', type: 'button', onClick: async () => {
      try { const job = await api.post(`/api/projects/${pid}/mix`, { ...mix(), label: 'ភ្លេង + សំឡេងខ្ញុំ' }); trackJob(job, (j) => mixCard.set(j)); } catch (e) { toast(errorText(e), 'bad'); }
    } }, '💾 រក្សាទុកជាកំណែថ្មី'));
  const mic = micStatus();
  mixBox.append(
    h('div', { class: 'note' }, 'បើម៉ូដែលច្រៀងខ្មែរមិនច្បាស់ សូមយក «ភ្លេងសុទ្ធ» ដែលកម្មវិធីបានបង្កើត មកលាយជាមួយសំឡេងច្រៀងផ្ទាល់ខ្លួនរបស់អ្នក ហើយកែកម្រិតសំឡេងទាំងពីរ។'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, '១) ភ្លេងសុទ្ធដែលបានបង្កើត'), instSel),
    h('div', { class: 'row' }, h('button', { class: 'sm', type: 'button', onClick: () => { music.mode = 'instrumental'; changed(); drawMode(); drawActions(); window.scrollTo({ top: 0, behavior: 'smooth' }); toast('បានប្ដូរទៅ «ភ្លេងសុទ្ធ» — ចុច «បង្កើតភ្លេងសុទ្ធ»', 'info'); } }, '＋ បង្កើតភ្លេងសុទ្ធថ្មី'), h('span', { class: 'small muted' }, 'ឬ upload ភ្លេងផ្ទាល់ខ្លួន៖'),
      h('input', { type: 'file', accept: 'audio/*', 'aria-label': 'upload ភ្លេង', onChange: async (ev) => { const f = ev.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); fd.append('label', f.name); fd.append('instrumental', '1'); try { p = await api.upload(`/api/projects/${pid}/versions/upload`, fd); setProject(p); drawVersions(); toast('បាននាំចូលភ្លេង ✓', 'ok'); } catch (e) { toast(errorText(e), 'bad'); } ev.target.value = ''; } })),
    h('div', null, h('strong', null, '២) សំឡេងច្រៀងរបស់អ្នក')),
    mic.ok ? h('div', { class: 'row' }, recBtn, recStatus)
      : h('div', { class: 'note warn' }, mic.reason === 'insecure' ? 'ការថតពី browser ត្រូវការ HTTPS ឬ localhost។ ពេលនេះអ្នកកំពុងប្រើ http:// តាមបណ្ដាញ Wi-Fi ដូច្នេះមីក្រូហ្វូនមិនអាចប្រើបាន។ ដំណោះស្រាយ៖ ថតដោយ «Voice Memos» លើ iPhone ហើយ upload ខាងក្រោម ឬបើក HTTPS (មើល README: Tailscale / --ssl-certfile)។' : 'browser នេះមិនគាំទ្រការថតសំឡេងទេ — សូម upload ឯកសារសំឡេងវិញ។'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ឬ upload ឯកសារសំឡេង (m4a, mp3, wav…)'), fileIn),
    voiceList,
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ជ្រើសសំឡេងដែលត្រូវលាយ'), voiceSel),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'កម្រិតភ្លេង: ', mdbOut), musicDb),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'កម្រិតសំឡេងរបស់ខ្ញុំ: ', vdbOut), voiceDb),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'រុញសំឡេងខ្ញុំយឺត/លឿន: ', offOut), offsetS, h('span', { class: 'small muted' }, 'ប្រើបើសំឡេងច្រៀងមិនត្រូវចង្វាក់ភ្លេង (ដោយសារពេលរង់ចាំមីក្រូ/Bluetooth)'))),
    mixButtons, previewBox, mixCard.el);
  paintSliders();

  // ======================= layout ===========================
  root.append(
    h('div', { class: 'stack' },
      h('section', { class: 'card' }, h('h3', null, '១) ម៉ូដែលបង្កើតតន្ត្រី', badge('ដំណើរការលើម៉ាស៊ីនរបស់អ្នក · មិនប្រើ Suno', 'ok')), engineBox),
      h('section', { class: 'card stack' }, h('h3', null, '២) របៀប'), modeSeg),
      h('section', { class: 'card stack' },
        h('h3', null, 'ការពិពណ៌នាសំឡេងដែលចង់បាន', badge('ការពិពណ៌នា · ម៉ូដែលអាចមិនធ្វើតាម', 'desc')),
        h('div', { class: 'note warn small' }, 'ស្ទីល ឧបករណ៍ និងអារម្មណ៍ខាងក្រោមគ្រាន់តែត្រូវបានបកប្រែជាអត្ថបទពិពណ៌នា (caption) ផ្ញើឱ្យម៉ូដែល — វាមិនមែនប៊ូតុងបញ្ជាផ្ទាល់ទេ។ ឧទាហរណ៍ ម៉ូដែលមិនមាន «កន្ទ្រឹម» ឬ «ខ្លុយ» ជាពាក្យស្គាល់ពិតប្រាកដទេ ដូច្នេះយើងបន្ថែមពាក្យអង់គ្លេសជិតស្និទ្ធ (flute, erhu, percussion…)។'),
        h('div', null, h('strong', null, 'ចង្វាក់ / ស្ទីល'), chipGroup('styles', presets.styles)),
        h('div', null, h('strong', null, 'ឧបករណ៍ដែលចង់ឮ'), chipGroup('instruments', presets.instruments)),
        h('div', null, h('strong', null, 'អារម្មណ៍'), chipGroup('moods', presets.moods)),
        h('div', null, h('strong', null, 'សំឡេងច្រៀង'), chipGroup('vocal', presets.vocals)),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'បន្ថែមពាក្យផ្ទាល់ខ្លួន'), extra),
        h('details', null, h('summary', null, 'មើល caption ដែលនឹងផ្ញើទៅម៉ូដែល ', captionLen), captionBox)),
      h('section', { class: 'card stack' }, h('h3', null, 'ការកំណត់ដែលម៉ូដែលគាំទ្រផ្ទាល់', badge('ប៉ារ៉ាម៉ែត្រពិតរបស់ម៉ូដែល', 'native')),
        h('div', { class: 'small muted' }, 'តម្លៃទាំងនេះត្រូវបានផ្ញើជាប៉ារ៉ាម៉ែត្រ (មិនមែនអត្ថបទ) — ទទេ = ឱ្យម៉ូដែលជ្រើសរើសខ្លួនឯង។'), nativeBox),
      h('section', { class: 'card stack' }, h('h3', null, '៣) បង្កើត'), actions, genCard.el),
      h('section', { class: 'stack' }, h('h3', null, '៤) កំណែបទទាំងអស់ (រក្សាទុកដាច់ដោយឡែក)'), compareBar, versionsBox,
        h('div', null, h('a', { class: 'btn primary', href: `#/p/${pid}/cover` }, 'បន្ទាប់៖ រូបគម្រប →'))),
      h('section', { class: 'card stack' }, h('h3', null, '៥) សំឡេងខ្ញុំច្រៀងផ្ទាល់ + ភ្លេង', badge('ជម្រើសបម្រុង', 'ok')), mixBox)));
  drawEngines(); drawMode(); drawNative(); drawActions(); drawVersions(); paintCaption();

  // re-attach to a job that was started before a refresh (real status survives page reloads)
  try {
    const { jobs } = await api.get(`/api/projects/${pid}/jobs`);
    const g = jobs.find((j) => j.kind === 'full' || j.kind === 'chorus_test');
    if (g && (isActive(g) || g.status === 'failed' || (Date.now() - Date.parse(g.created_at)) < 15 * 60 * 1000)) { if (isActive(g)) trackJob(g, (j) => genCard.set(j)); else genCard.set(g, { restored: true }); }
    const m = jobs.find((j) => j.kind === 'mix');
    if (m && isActive(m)) trackJob(m, (j) => mixCard.set(j));
  } catch { /* ignore */ }

  return async () => {
    await persist.flush();
    players.splice(0).forEach((pl) => pl.destroy());
    quickPlayers.splice(0).forEach((pl) => pl.destroy());
    if (rec) rec.cancel();
    clearInterval(recTick);
    cleanups.forEach((f) => f());
  };
}
