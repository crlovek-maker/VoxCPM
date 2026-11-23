// Panel 1 — compose & edit lyrics (Verse / Chorus / Bridge ...), save, optional local-LLM help.
import { api, errorText } from '../api.js';
import { state, setProject } from '../state.js';
import { h, clear, toast, modal, confirmDialog, debounce, autoGrow, badge, spinner } from '../ui.js';

const LIMIT = 4096; // characters the music model accepts for lyrics

const uid = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function renderLyrics(root, { project, pid }) {
  const types = state.presets.section_types;
  let sections = JSON.parse(JSON.stringify(project.lyrics.sections));
  let historyCount = project.lyrics_history.length;
  const list = h('div', { class: 'stack' });
  const saveState = h('span', { class: 'savestate' }, 'រក្សាទុករួច ✓');
  const stats = h('div', { class: 'small muted' });
  const undoBtn = h('button', { class: 'sm', type: 'button', onClick: doUndo }, '↶ ត្រឡប់ការកែ AI/ជំនួស');
  let pendingHistory = null;

  const save = debounce(async () => {
    saveState.className = 'savestate'; saveState.textContent = 'កំពុងរក្សាទុក…';
    try {
      const body = { sections };
      if (pendingHistory) { body.history_label = pendingHistory; pendingHistory = null; }
      const p = await api.put(`/api/projects/${pid}/lyrics`, body);
      historyCount = p.lyrics_history.length;
      setProject(p);
      saveState.className = 'savestate ok'; saveState.textContent = 'រក្សាទុករួច ✓';
      paintUndo();
    } catch (e) { saveState.className = 'savestate bad'; saveState.textContent = 'រក្សាទុកមិនបាន: ' + errorText(e); }
  }, 700);

  function engineText() {
    const counts = {}; const blocks = [];
    for (const s of sections) {
      const lines = s.lines.filter((l) => l.trim());
      if (!lines.length) continue;
      counts[s.type] = (counts[s.type] || 0) + 1;
      let tag = types[s.type].tag; if (s.type === 'verse') tag += ' ' + counts[s.type];
      blocks.push(`[${tag}]\n${lines.join('\n')}`);
    }
    return blocks.join('\n\n');
  }
  function paintStats() {
    const lines = sections.reduce((n, s) => n + s.lines.filter((l) => l.trim()).length, 0);
    const chars = engineText().length;
    stats.className = 'small ' + (chars > LIMIT ? 'bad' : chars > LIMIT * 0.85 ? 'warn' : 'muted');
    stats.textContent = `${sections.length} ផ្នែក · ${lines} បន្ទាត់ · ${chars}/${LIMIT} តួអក្សរដែលផ្ញើទៅម៉ូដែល` + (chars > LIMIT ? ' — វែងពេក! ម៉ូដែលនឹងបដិសេធ' : '');
  }
  function paintUndo() { undoBtn.classList.toggle('hidden', !historyCount); }
  function changed(label) { if (label) pendingHistory = label; paintStats(); save(); }

  async function doUndo() {
    save.cancel();
    try { const p = await api.post(`/api/projects/${pid}/lyrics/undo`); setProject(p); sections = JSON.parse(JSON.stringify(p.lyrics.sections)); historyCount = p.lyrics_history.length; draw(); toast('បានត្រឡប់ទំនុកទៅមុនពេលកែ', 'ok'); } catch (e) { toast(errorText(e), 'bad'); }
  }

  function move(i, d) { const j = i + d; if (j < 0 || j >= sections.length) return; [sections[i], sections[j]] = [sections[j], sections[i]]; draw(); changed(); }

  function sectionCard(s, i) {
    const ta = h('textarea', { rows: 4, placeholder: 'សរសេរទំនុកនៅទីនេះ — មួយបន្ទាត់ក្នុងមួយឃ្លា', 'aria-label': `ទំនុកផ្នែកទី ${i + 1}` });
    ta.value = s.lines.join('\n');
    ta.addEventListener('input', () => { s.lines = ta.value.split('\n'); changed(); });
    autoGrow(ta, 110);
    const sel = h('select', { 'aria-label': 'ប្រភេទផ្នែក', style: { maxWidth: '230px' } },
      ...Object.entries(types).map(([k, v]) => h('option', { value: k, selected: k === s.type }, v.km)));
    sel.addEventListener('change', () => { s.type = sel.value; draw(); changed(); });
    return h('div', { class: `card section-card ${s.type}` },
      h('div', { class: 'row spread' },
        h('div', { class: 'row' }, h('strong', null, `#${i + 1}`), sel),
        h('div', { class: 'row' },
          h('button', { class: 'sm icon', type: 'button', title: 'ឡើងលើ', onClick: () => move(i, -1), disabled: i === 0 }, '▲'),
          h('button', { class: 'sm icon', type: 'button', title: 'ចុះក្រោម', onClick: () => move(i, 1), disabled: i === sections.length - 1 }, '▼'),
          h('button', { class: 'sm icon', type: 'button', title: 'ចម្លងផ្នែកនេះ', onClick: () => { sections.splice(i + 1, 0, { id: uid(), type: s.type, lines: [...s.lines] }); draw(); changed(); } }, '⧉'),
          h('button', { class: 'sm icon danger', type: 'button', title: 'លុបផ្នែកនេះ', onClick: async () => {
            if (s.lines.some((l) => l.trim()) && !(await confirmDialog('លុបផ្នែកនេះ? (អាចប្រើ Undo មិនបាន)', { ok: 'លុប', danger: true }))) return;
            sections.splice(i, 1); draw(); changed();
          } }, '🗑'))),
      ta,
      h('div', { class: 'row spread' },
        h('span', { class: 'small muted' }, 'បន្ទាត់: ', s.lines.filter((l) => l.trim()).length),
        h('button', { class: 'sm', type: 'button', onClick: () => openAssist(i) }, '🤖 ជំនួយកែពាក្យជួន/ឃ្លា (ម៉ូដែលអត្ថបទក្នុងម៉ាស៊ីន)')));
  }

  function draw() {
    clear(list);
    if (!sections.length) list.append(h('div', { class: 'card center muted' }, 'មិនទាន់មានទំនុក — ចុច «＋ ផ្នែកថ្មី» ឬ «បិទភ្ជាប់ទំនុក»។'));
    sections.forEach((s, i) => list.append(sectionCard(s, i)));
    paintStats(); paintUndo();
  }

  // ---- add / paste
  const addType = h('select', { 'aria-label': 'ប្រភេទផ្នែកថ្មី' }, ...Object.entries(types).map(([k, v]) => h('option', { value: k, selected: k === 'verse' }, v.km)));
  const addBtn = h('button', { class: 'primary', type: 'button', onClick: () => { sections.push({ id: uid(), type: addType.value, lines: [] }); draw(); changed(); setTimeout(() => list.lastChild && list.lastChild.querySelector('textarea').focus(), 30); } }, '＋ ផ្នែកថ្មី');
  const pasteBtn = h('button', { type: 'button', onClick: openPaste }, '📋 បិទភ្ជាប់ទំនុក');

  function openPaste() {
    const ta = h('textarea', { rows: 10, placeholder: '[Verse]\nឃ្លាទី១\nឃ្លាទី២\n\n[Chorus]\n…' });
    const preview = h('div', { class: 'stack small' });
    let parsed = [];
    const mode = { v: 'replace' };
    const parse = debounce(async () => {
      if (!ta.value.trim()) { clear(preview); parsed = []; return; }
      try {
        parsed = (await api.post('/api/lyrics/parse', { text: ta.value })).sections;
        clear(preview);
        preview.append(h('div', { class: 'muted' }, `រកឃើញ ${parsed.length} ផ្នែក៖`));
        parsed.forEach((s) => preview.append(h('div', null, badge(types[s.type].km), ' ', s.lines.length, ' បន្ទាត់ · ', h('span', { class: 'muted' }, s.lines[0] || ''))));
      } catch (e) { clear(preview); preview.append(h('div', { class: 'note bad' }, errorText(e))); }
    }, 350);
    ta.addEventListener('input', parse);
    const radio = (v, label) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'pm', checked: mode.v === v, onChange: () => { mode.v = v; } }), label);
    modal({
      title: 'បិទភ្ជាប់ទំនុក', wide: true,
      body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'ប្រើបន្ទាត់ចំណងជើងដូចជា [Verse] [Chorus] [Bridge] ឬ «បន្ទរ» ដើម្បីបែងចែកផ្នែក។ បើគ្មានចំណងជើង ចន្លោះបន្ទាត់ទទេនឹងបែងចែកផ្នែក (ផ្នែកដែលស្ទួន = Chorus)។'), ta, preview,
        h('div', null, radio('replace', 'ជំនួសទំនុកទាំងអស់ (អាច Undo)'), radio('append', 'បន្ថែមខាងចុង'))),
      actions: [{ label: 'បោះបង់' }, { label: 'ដាក់ចូល', class: 'primary', onClick: () => {
        if (!parsed.length) { toast('មិនទាន់មានទំនុកសម្រាប់ដាក់ចូលទេ', 'warn'); return false; }
        const fresh = parsed.map((s) => ({ ...s, id: uid() }));
        if (mode.v === 'replace') { sections = fresh; changed('មុនបិទភ្ជាប់ទំនុក'); } else { sections = sections.concat(fresh); changed(); }
        draw();
      } }],
    });
    setTimeout(() => ta.focus(), 50);
  }

  // ---- AI assist: propose -> read -> choose -> apply (nothing is replaced before the user picks)
  async function openAssist(idx) {
    const s = sections[idx];
    await save.flush(); // the server reads the lyrics from the saved project, so make sure it is up to date
    let status = { configured: false };
    try { status = await api.get('/api/llm/status'); } catch { /* ignore */ }
    const body = h('div', { class: 'stack' });
    const result = h('div', { class: 'stack' });
    if (!status.configured || !status.reachable) {
      body.append(h('div', { class: 'note warn' }, h('strong', null, 'ម៉ូដែលអត្ថបទមិនទាន់ដំណើរការ: '), status.message || '', h('div', { class: 'small' }, 'ដំឡើង Ollama → ', h('span', { class: 'mono' }, 'ollama pull qwen3:8b'), ' → កំណត់ ', h('span', { class: 'mono' }, 'LLM_MODEL=qwen3:8b'), ' ក្នុងឯកសារ .env រួចចាប់ផ្ដើមកម្មវិធីឡើងវិញ។ គុណភាពភាសាខ្មែរអាស្រ័យលើម៉ូដែលដែលអ្នកជ្រើស — ត្រូវសាកល្បងបន្ថែម។')));
    } else {
      body.append(h('div', { class: 'note' }, 'ម៉ូដែលអត្ថបទ៖ ', h('strong', null, status.model), ' (ក្នុងម៉ាស៊ីនអ្នក) — វាស្នើតែការណែនាំ អ្នកជាអ្នកជ្រើសមុនពេលជំនួស។'));
    }
    const picks = s.lines.map((ln, i) => ({ i, text: ln })).filter((x) => x.text.trim());
    const checks = picks.map((p) => h('input', { type: 'checkbox', checked: true }));
    const modeSel = h('select', null,
      h('option', { value: 'rhyme' }, 'កែពាក្យចុងបន្ទាត់ឱ្យជួន (rhyme)'),
      h('option', { value: 'rewrite' }, 'សរសេរឡើងវិញតាមការណែនាំ'),
      h('option', { value: 'continue' }, 'បន្ថែមឃ្លាបន្ត'),
      h('option', { value: 'translate' }, 'បកប្រែ ខ្មែរ ↔ អង់គ្លេស'));
    const instr = h('input', { type: 'text', placeholder: 'ការណែនាំបន្ថែម (ជម្រើស) ឧ. «ឱ្យស្ដាប់ស្រទន់ជាងនេះ»' });
    const count = h('select', null, ...[2, 3, 4].map((n) => h('option', { value: n, selected: n === 3 }, `${n} ជម្រើស`)));
    const go = h('button', { class: 'primary', type: 'button', disabled: !status.configured || !status.reachable }, '🤖 ស្នើសុំការណែនាំ');
    body.append(
      h('div', null, h('strong', null, 'ជ្រើសបន្ទាត់ដែលចង់ឱ្យជួយ៖'), ...picks.map((p, k) => h('label', { class: 'check' }, checks[k], h('span', null, p.text)))),
      h('div', { class: 'grid2' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'របៀប'), modeSel), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ចំនួនជម្រើស'), count)),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ការណែនាំ'), instr), go, result);

    go.addEventListener('click', async () => {
      const chosen = picks.filter((_, k) => checks[k].checked).map((p) => p.i);
      if (!chosen.length && modeSel.value !== 'continue') { toast('សូមជ្រើសយ៉ាងហោចណាស់មួយបន្ទាត់', 'warn'); return; }
      clear(result); result.append(h('div', { class: 'row' }, spinner(), 'កំពុងសួរម៉ូដែលអត្ថបទក្នុងម៉ាស៊ីន… (អាចចំណាយពេលបន្តិច)'));
      go.disabled = true;
      try {
        const r = await api.post(`/api/projects/${pid}/lyrics/assist`, { mode: modeSel.value, section_id: s.id, line_indexes: chosen, instruction: instr.value, count: Number(count.value) });
        showSuggestions(r);
      } catch (e) { clear(result); result.append(h('div', { class: 'note bad' }, errorText(e), e.detail ? h('details', null, h('summary', null, 'លម្អិត'), h('div', { class: 'mono' }, e.detail)) : null)); }
      go.disabled = false;
    });

    function showSuggestions(r) {
      clear(result);
      const sug = r.suggestions; const idxs = r.line_indexes; const cont = r.mode === 'continue';
      result.append(h('h3', null, 'អានហើយជ្រើស — មិនទាន់ជំនួសអ្វីទេ'));
      let apply;
      if (cont) {
        let chosenS = 0;
        sug.forEach((x, k) => result.append(h('label', { class: 'card flat check' }, h('input', { type: 'radio', name: 'cont', checked: k === 0, onChange: () => { chosenS = k; } }),
          h('div', null, h('strong', null, `ជម្រើស ${k + 1}`), ...x.lines.map((l) => h('div', null, l)), x.note ? h('div', { class: 'small muted' }, x.note) : null))));
        apply = () => { const at = idxs.length ? Math.max(...idxs) + 1 : s.lines.length; s.lines.splice(at, 0, ...sug[chosenS].lines); };
      } else {
        const pick = idxs.map(() => -1); // -1 = keep original line
        const cells = [];
        const table = h('table', { class: 'cmp' }, h('thead', null, h('tr', null, h('th', null, 'បន្ទាត់ដើម'), ...sug.map((_, k) => h('th', null, `ជម្រើស ${k + 1}`)))));
        const tb = h('tbody');
        const paint = () => cells.forEach(({ el, j, k }) => el.classList.toggle('on', pick[j] === k));
        idxs.forEach((lineIdx, j) => {
          const tr = h('tr');
          const mk = (k, text) => { const el = h('button', { class: 'opt', type: 'button', onClick: () => { pick[j] = k; paint(); } }, text || '—'); cells.push({ el, j, k }); return h('td', null, el); };
          tr.append(mk(-1, s.lines[lineIdx]));
          sug.forEach((x, k) => tr.append(mk(k, x.lines[j])));
          tb.append(tr);
        });
        table.append(tb); paint();
        result.append(h('div', { class: 'cmpwrap' }, table),
          h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'ใช้ทุกบรรทัดจาก:'), ...sug.map((_, k) => h('button', { class: 'sm', type: 'button', onClick: () => { idxs.forEach((__, j) => { pick[j] = k; }); paint(); } }, `ជម្រើស ${k + 1}`)), h('button', { class: 'sm ghost', type: 'button', onClick: () => { idxs.forEach((__, j) => { pick[j] = -1; }); paint(); } }, 'ដើមទាំងអស់')),
          ...sug.map((x, k) => (x.note || !x.line_count_ok) ? h('div', { class: 'small muted' }, `ជម្រើស ${k + 1}: `, x.note, !x.line_count_ok ? h('span', { class: 'badge warn' }, 'ចំនួនបន្ទាត់មិនត្រូវ') : null) : null));
        apply = () => { idxs.forEach((lineIdx, j) => { if (pick[j] >= 0 && sug[pick[j]].lines[j] !== undefined) s.lines[lineIdx] = sug[pick[j]].lines[j]; }); };
      }
      result.append(h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onClick: () => { apply(); draw(); changed('មុនប្រើការណែនាំ AI'); toast('បានដាក់ទំនុកថ្មី — ចុច «ត្រឡប់» ប្រសិនបើចង់បានដើមវិញ', 'ok'); assistModal.close(); } }, 'ដាក់ឃ្លាដែលបានជ្រើសចូល'), h('span', { class: 'small muted' }, 'ទំនុកដើមត្រូវបានរក្សា អាចត្រឡប់វិញបាន')));
    }
    const assistModal = modal({ title: `🤖 ជំនួយទំនុក — ផ្នែក #${idx + 1}`, body, actions: [{ label: 'បិទ' }], wide: true });
  }

  root.append(
    h('div', { class: 'note' }, 'ទំនុកដែលអ្នកសរសេរនឹងត្រូវផ្ញើទៅម៉ូដែលបង្កើតបទដោយផ្ទាល់ (ភាសាខ្មែរ ឬអង់គ្លេស)។ ផ្នែក Verse/Chorus/Bridge ជួយឱ្យម៉ូដែលស្គាល់រចនាសម្ព័ន្ធបទ។'),
    h('div', { class: 'row spread', style: { margin: '12px 0' } }, h('div', { class: 'row' }, addType, addBtn, pasteBtn, undoBtn), saveState),
    list, h('div', { style: { margin: '10px 2px' } }, stats),
    h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/p/${pid}/music` }, 'បន្ទាប់៖ បង្កើតតន្ត្រី →')));
  draw();
  return async () => { if (save.flush) await save.flush(); };
}
