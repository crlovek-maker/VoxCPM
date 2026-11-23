// Panel 3 — cover art / thumbnail: import a picture, crop by dragging/pinching, add a Khmer title
// (or export without text), 1:1 / 16:9 / 9:16, download PNG, use as the MV background.
import { api, errorText } from '../api.js';
import { state, setProject } from '../state.js';
import { h, clear, toast, confirmDialog, triggerDownload, badge } from '../ui.js';

const SIZES = { '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920] };
const ASPECT_LABEL = { '1:1': '1:1 · រូបគម្របបទ', '16:9': '16:9 · YouTube Thumbnail', '9:16': '9:16 · Shorts/TikTok' };
const FONTS = [['Noto Sans Khmer', 'Noto Sans Khmer (ស្អាត ទំនើប)'], ['Hanuman', 'Hanuman (បុរាណ)'], ['Moul', 'Moul (ចំណងជើងធំ)']];
const BACKGROUNDS = {
  sunrise: ['ព្រលឹម', ['#0a1252', '#4a1e80', '#b03848'], '#ffb048'],
  night: ['រាត្រី', ['#050818', '#101a4a', '#27307a'], '#7aa2ff'],
  ocean: ['មហាសមុទ្រ', ['#032c4d', '#0a6c8f', '#6fd1c9'], '#fff2a8'],
  violet: ['ស្វាយ', ['#2a0a4a', '#6a1b9a', '#e0529c'], '#ffd1a8'],
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export async function renderCover(root, { project, pid }) {
  let p = project;
  const saved = p.cover.editor || {};
  let aspect = Object.keys(p.cover.files)[0] || '16:9';
  const defaults = () => ({ src: null, zoom: 1, ox: 0, oy: 0, bg: 'sunrise', text: { enabled: true, title: p.title || 'ចំណងជើងបទ', subtitle: p.artist || '', font: 'Noto Sans Khmer', size: 120, color: '#ffffff', stroke: '#000000', strokeW: 7, shadow: true, pos: 'bottom', yOffset: 0, align: 'center', scrim: true } });
  const store = {}; // aspect -> editor state
  for (const a of Object.keys(SIZES)) store[a] = { ...defaults(), ...(saved[a] || {}), text: { ...defaults().text, ...((saved[a] || {}).text || {}) } };
  let st = store[aspect];
  let img = null; // HTMLImageElement for st.src
  let dirty = false;

  const canvas = h('canvas', { id: 'cover', 'aria-label': 'พื้นที่แก้ไขรูปปก' });
  const ctx = canvas.getContext('2d');
  const wrap = h('div', { class: 'canvaswrap' }, canvas);

  // ---------------- drawing ----------------
  async function ensureFonts() {
    try { await Promise.all(FONTS.map(([f]) => document.fonts.load(`700 48px "${f}"`, 'ខ្មែរAa'))); } catch { /* ignore */ }
  }
  function drawBackground(c, W, H) {
    if (img) {
      const iw = img.naturalWidth; const ih = img.naturalHeight;
      const sc = Math.max(W / iw, H / ih) * st.zoom; const dw = iw * sc; const dh = ih * sc;
      const mx = Math.max(0, (dw - W) / 2); const my = Math.max(0, (dh - H) / 2);
      st.ox = clamp(st.ox, -mx, mx); st.oy = clamp(st.oy, -my, my);
      c.drawImage(img, W / 2 - dw / 2 + st.ox, H / 2 - dh / 2 + st.oy, dw, dh);
      return;
    }
    const [, stops, glow] = BACKGROUNDS[st.bg] || BACKGROUNDS.sunrise;
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stops[0]); g.addColorStop(0.55, stops[1]); g.addColorStop(1, stops[2]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rg = c.createRadialGradient(W / 2, H * 0.28, 0, W / 2, H * 0.28, Math.min(W, H) * 0.7);
    rg.addColorStop(0, glow + 'cc'); rg.addColorStop(1, glow + '00');
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
  }
  function wrapRows(c, text, maxW, fs, font) {
    let size = fs;
    for (let tries = 0; tries < 12; tries++) {
      c.font = `700 ${size}px "${font}"`;
      const words = text.split(/\s+/).filter(Boolean); const rows = []; let cur = '';
      for (const w of words) {
        const trial = cur ? `${cur} ${w}` : w;
        if (cur && c.measureText(trial).width > maxW) { rows.push(cur); cur = w; } else cur = trial;
      }
      if (cur) rows.push(cur);
      if (rows.every((r) => c.measureText(r).width <= maxW) || size < fs * 0.5) return { rows, size };
      size *= 0.92; // an unbreakable word is too wide: shrink instead of running off the picture
    }
    return { rows: [text], size };
  }
  function drawText(c, W, H) {
    const t = st.text;
    if (!t.enabled || (!t.title.trim() && !t.subtitle.trim())) return;
    const short = Math.min(W, H); const k = short / 1080;
    const maxW = W * 0.86;
    const main = t.title.trim() ? wrapRows(c, t.title.trim(), maxW, t.size * k, t.font) : { rows: [], size: 0 };
    const subSize = Math.round(t.size * k * 0.5);
    const sub = t.subtitle.trim() ? wrapRows(c, t.subtitle.trim(), maxW, subSize, t.font) : { rows: [], size: 0 };
    const lh = 1.55;
    const blockH = main.rows.length * main.size * lh + (sub.rows.length ? sub.size * lh * sub.rows.length + main.size * 0.2 : 0);
    const anchor = { top: H * 0.14, center: H * 0.5 - blockH / 2, bottom: H * 0.88 - blockH }[t.pos] + (t.yOffset / 100) * H;
    const x = { left: W * 0.07, center: W / 2, right: W * 0.93 }[t.align];
    if (t.scrim) {
      const y0 = clamp(anchor - main.size, 0, H); const y1 = clamp(anchor + blockH + main.size, 0, H);
      const g = c.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,.5)'); g.addColorStop(0.65, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, y0, W, y1 - y0);
    }
    c.textAlign = t.align; c.textBaseline = 'middle'; c.lineJoin = 'round';
    let y = anchor;
    const paintRows = (rows, size, color, weight) => {
      c.font = `${weight} ${size}px "${t.font}"`;
      for (const r of rows) {
        y += (size * lh) / 2;
        if (t.shadow) { c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = size * 0.18; c.shadowOffsetY = size * 0.05; }
        if (t.strokeW > 0) { c.lineWidth = t.strokeW * k * 2; c.strokeStyle = t.stroke; c.strokeText(r, x, y); }
        c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
        c.fillStyle = color; c.fillText(r, x, y);
        y += (size * lh) / 2;
      }
    };
    paintRows(main.rows, main.size, t.color, 700);
    if (sub.rows.length) { y += main.size * 0.2; paintRows(sub.rows, sub.size, t.color, 400); }
  }
  function render(c, W, H, withText) { c.clearRect(0, 0, W, H); drawBackground(c, W, H); if (withText) drawText(c, W, H); }
  function redraw() {
    const [W, H] = SIZES[aspect];
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    render(ctx, W, H, true);
  }
  const toBlob = (withText) => new Promise((res) => {
    const [W, H] = SIZES[aspect]; const c = document.createElement('canvas'); c.width = W; c.height = H;
    render(c.getContext('2d'), W, H, withText); c.toBlob(res, 'image/png');
  });

  // ---------------- gestures ----------------
  const pointers = new Map(); let lastDist = null;
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastDist = null; canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY }; pointers.set(e.pointerId, cur);
    const k = canvas.width / canvas.getBoundingClientRect().width;
    if (pointers.size === 1) { st.ox += (cur.x - prev.x) * k; st.oy += (cur.y - prev.y) * k; dirty = true; redraw(); }
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) { st.zoom = clamp(st.zoom * (d / lastDist), 1, 5); zoomIn.value = st.zoom; dirty = true; redraw(); }
      lastDist = d;
    }
  });
  const up = (e) => { pointers.delete(e.pointerId); lastDist = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = clamp(st.zoom * (e.deltaY < 0 ? 1.06 : 0.94), 1, 5); zoomIn.value = st.zoom; dirty = true; redraw(); }, { passive: false });

  // ---------------- controls ----------------
  const aspectSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'សមាមាត្រ' });
  function drawAspect() {
    clear(aspectSeg);
    Object.keys(SIZES).forEach((a) => aspectSeg.append(h('button', { type: 'button', class: a === aspect ? 'on' : '', onClick: () => switchAspect(a) }, ASPECT_LABEL[a])));
  }
  async function loadImageFor(stObj) {
    img = null;
    if (stObj.src) {
      await new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => { img = i; res(); }; i.onerror = () => { stObj.src = null; res(); }; i.src = stObj.src.url || `/media/${pid}/covers/${stObj.src.file}`; });
    }
  }
  async function switchAspect(a) { aspect = a; st = store[a]; await loadImageFor(st); drawAspect(); syncControls(); redraw(); drawSaved(); }

  const fileIn = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'ជ្រើសរូបភាព' });
  async function useFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    await new Promise((res, rej) => { i.onload = res; i.onerror = rej; i.src = url; }).catch(() => { toast('មិនអាចបើករូបភាពនេះបានទេ', 'bad'); });
    if (!i.naturalWidth) return;
    img = i; st.src = { url, file: null }; st.zoom = 1; st.ox = 0; st.oy = 0; zoomIn.value = 1; dirty = true; redraw();
    const fd = new FormData(); fd.append('image', file);
    try { const r = await api.upload(`/api/projects/${pid}/cover/source`, fd); st.src = { file: r.file, url: r.url }; } catch (e) { toast('រក្សាទុករូបដើមមិនបាន (នៅតែកែបាន): ' + errorText(e), 'warn'); }
  }
  fileIn.addEventListener('change', () => useFile(fileIn.files[0]));
  wrap.addEventListener('dragover', (e) => e.preventDefault());
  wrap.addEventListener('drop', (e) => { e.preventDefault(); useFile(e.dataTransfer.files[0]); });

  const zoomIn = h('input', { type: 'range', min: 1, max: 5, step: 0.01, value: 1, 'aria-label': 'ពង្រីក' });
  zoomIn.addEventListener('input', () => { st.zoom = Number(zoomIn.value); dirty = true; redraw(); });
  const bgRow = h('div', { class: 'chips' }, ...Object.entries(BACKGROUNDS).map(([k, [label]]) => h('button', { type: 'button', class: 'chip', onClick: () => { img = null; st.src = null; st.bg = k; dirty = true; redraw(); } }, label)));

  const titleIn = h('input', { type: 'text', maxlength: 120, placeholder: 'ចំណងជើង' });
  const subIn = h('input', { type: 'text', maxlength: 120, placeholder: 'ឈ្មោះសិល្បករ' });
  const fontSel = h('select', null, ...FONTS.map(([v, l]) => h('option', { value: v }, l)));
  const sizeIn = h('input', { type: 'range', min: 40, max: 260, step: 2 });
  const colorIn = h('input', { type: 'color' }); const strokeIn = h('input', { type: 'color' });
  const strokeW = h('input', { type: 'range', min: 0, max: 20, step: 1 });
  const posSel = h('select', null, h('option', { value: 'top' }, 'ខាងលើ'), h('option', { value: 'center' }, 'កណ្ដាល'), h('option', { value: 'bottom' }, 'ខាងក្រោម'));
  const yOff = h('input', { type: 'range', min: -30, max: 30, step: 1 });
  const alignSel = h('select', null, h('option', { value: 'left' }, 'ឆ្វេង'), h('option', { value: 'center' }, 'កណ្ដាល'), h('option', { value: 'right' }, 'ស្ដាំ'));
  const shadowIn = h('input', { type: 'checkbox' }); const scrimIn = h('input', { type: 'checkbox' });
  const noText = h('input', { type: 'checkbox' });
  const bind = (el, get, set, evt = 'input') => { el.addEventListener(evt, async () => { set(el.type === 'checkbox' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value)); dirty = true; if (el === fontSel) await ensureFonts(); redraw(); }); };
  bind(titleIn, null, (v) => { st.text.title = v; }); bind(subIn, null, (v) => { st.text.subtitle = v; }); bind(fontSel, null, (v) => { st.text.font = v; }, 'change');
  bind(sizeIn, null, (v) => { st.text.size = v; }); bind(colorIn, null, (v) => { st.text.color = v; }); bind(strokeIn, null, (v) => { st.text.stroke = v; });
  bind(strokeW, null, (v) => { st.text.strokeW = v; }); bind(posSel, null, (v) => { st.text.pos = v; }, 'change'); bind(yOff, null, (v) => { st.text.yOffset = v; });
  bind(alignSel, null, (v) => { st.text.align = v; }, 'change'); bind(shadowIn, null, (v) => { st.text.shadow = v; }, 'change'); bind(scrimIn, null, (v) => { st.text.scrim = v; }, 'change');
  bind(noText, null, (v) => { st.text.enabled = !v; }, 'change');
  function syncControls() {
    const t = st.text;
    titleIn.value = t.title; subIn.value = t.subtitle; fontSel.value = t.font; sizeIn.value = t.size; colorIn.value = t.color; strokeIn.value = t.stroke; strokeW.value = t.strokeW;
    posSel.value = t.pos; yOff.value = t.yOffset; alignSel.value = t.align; shadowIn.checked = t.shadow; scrimIn.checked = t.scrim; noText.checked = !t.enabled; zoomIn.value = st.zoom;
  }
  const field = (label, el) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el);
  const mvUse = h('select', null, h('option', { value: 'plain' }, 'ប្រើរូបគ្មានអក្សរ (ណែនាំ — MV មានទំនុករួចហើយ)'), h('option', { value: 'final' }, 'ប្រើរូបមានចំណងជើង'), h('option', { value: '' }, 'កុំប្ដូរផ្ទៃខាងក្រោយ MV'));

  // ---------------- save / export ----------------
  async function save(setMv = true) {
    const hasText = st.text.enabled && (st.text.title.trim() || st.text.subtitle.trim());
    const final = await toBlob(true);
    const fd = new FormData();
    fd.append('final', final, `cover_${aspect.replace(':', 'x')}.png`);
    if (hasText) fd.append('plain', await toBlob(false), 'plain.png');
    fd.append('aspect', aspect); fd.append('title', st.text.title); fd.append('has_text', hasText ? '1' : '0');
    fd.append('mv_use', setMv ? (hasText ? mvUse.value : (mvUse.value ? 'final' : '')) : '');
    fd.append('editor', JSON.stringify({ src: st.src && st.src.file ? { file: st.src.file } : null, zoom: st.zoom, ox: st.ox, oy: st.oy, bg: st.bg, text: st.text }));
    const np = await api.upload(`/api/projects/${pid}/cover`, fd);
    p = np; setProject(np); dirty = false; drawSaved();
    return np;
  }
  const saveBtn = h('button', { class: 'primary big', type: 'button', onClick: async () => { try { await save(true); toast('បានរក្សាទុករូបគម្រប ✓', 'ok'); } catch (e) { toast(errorText(e), 'bad'); } } }, '💾 រក្សាទុករូបគម្រប');
  const dlBtn = h('button', { type: 'button', onClick: async () => { const b = await toBlob(true); triggerDownload(URL.createObjectURL(b), `cover_${aspect.replace(':', 'x')}.png`); toast('បើមិនទាញយកភ្លាមលើ iPhone ចុចរូបឱ្យយូរ រួចជ្រើស «រក្សាទុករូបភាព» — ឬប្រើប៊ូតុងទាញយកខាងក្រោមក្រោយរក្សាទុក', 'info', 6000); } }, '⬇ ទាញយក PNG');
  const dlPlainBtn = h('button', { type: 'button', onClick: async () => { const b = await toBlob(false); triggerDownload(URL.createObjectURL(b), `cover_${aspect.replace(':', 'x')}_notext.png`); } }, '⬇ PNG គ្មានអក្សរ');

  // ---------------- saved list ----------------
  const savedBox = h('div', { class: 'stack' });
  function drawSaved() {
    clear(savedBox);
    const entries = Object.entries(p.cover.files);
    if (!entries.length) { savedBox.append(h('div', { class: 'muted small' }, 'មិនទាន់មានរូបគម្របដែលបានរក្សាទុកទេ។')); return; }
    const thumbs = h('div', { class: 'thumbs' });
    for (const [a, e] of entries) {
      const using = p.cover.mv_background && (p.cover.mv_background === e.file || p.cover.mv_background === e.plain);
      thumbs.append(h('div', { class: `thumb ${using ? 'on' : ''}` }, h('img', { src: `/media/${pid}/covers/${e.file}`, alt: a, loading: 'lazy' }),
        h('div', null, h('strong', null, a), ' ', e.has_text ? badge('មានអក្សរ') : badge('គ្មានអក្សរ'), using ? badge('MV ✓', 'ok') : null),
        h('a', { class: 'btn sm', href: `/media/${pid}/covers/${e.file}?dl=1&as_name=${encodeURIComponent('cover_' + a.replace(':', 'x') + '.png')}`, download: '' }, '⬇ PNG'),
        e.plain ? h('a', { class: 'btn sm', href: `/media/${pid}/covers/${e.plain}?dl=1&as_name=${encodeURIComponent('cover_' + a.replace(':', 'x') + '_notext.png')}`, download: '' }, '⬇ គ្មានអក្សរ') : null,
        h('button', { class: 'sm', type: 'button', onClick: async () => { try { setProject(p = await api.post(`/api/projects/${pid}/cover/mv-background`, { file: e.plain || e.file })); drawSaved(); toast('ប្រើជាផ្ទៃខាងក្រោយ MV ✓', 'ok'); } catch (er) { toast(errorText(er), 'bad'); } } }, 'ប្រើក្នុង MV'),
        h('button', { class: 'sm danger', type: 'button', onClick: async () => { if (await confirmDialog('លុបរូបគម្របនេះ?', { ok: 'លុប', danger: true })) { try { setProject(p = await api.del(`/api/projects/${pid}/cover/${a.replace(':', 'x')}`)); drawSaved(); } catch (er) { toast(errorText(er), 'bad'); } } } }, '🗑')));
    }
    savedBox.append(thumbs);
  }

  root.append(h('div', { class: 'stack' },
    h('div', { class: 'note' }, 'បញ្ចូលរូប អូសដើម្បីរំកិល ហើយប្រើ ២ ម្រាមដៃ (pinch) ឬរបារខាងក្រោមដើម្បីពង្រីក។ អក្សរខ្មែរត្រូវបានគូរដោយពុម្ពអក្សរដែលមានស្រៈ និងជើងត្រឹមត្រូវ។'),
    h('div', { class: 'row' }, aspectSeg),
    wrap,
    h('div', { class: 'card stack' }, h('h3', null, 'រូបភាព'),
      h('div', { class: 'row' }, fileIn, h('span', { class: 'small muted' }, 'ឬជ្រើសផ្ទៃរចនាស្រាប់៖')), bgRow, field('ពង្រីក / កាត់តម្រឹម', zoomIn)),
    h('div', { class: 'card stack' }, h('h3', null, 'ចំណងជើងខ្មែរ'),
      h('label', { class: 'check' }, noText, 'មិនដាក់អក្សរ (រូបគ្មានអក្សរ)'),
      h('div', { class: 'grid2' }, field('ចំណងជើង', titleIn), field('ឈ្មោះសិល្បករ', subIn), field('ពុម្ពអក្សរ', fontSel), field('ទំហំអក្សរ', sizeIn),
        h('div', { class: 'row' }, field('ពណ៌អក្សរ', colorIn), field('ពណ៌គែម', strokeIn)), field('កម្រាស់គែម', strokeW),
        field('ទីតាំង', posSel), field('រុញឡើង/ចុះ', yOff), field('តម្រឹម', alignSel)),
      h('div', { class: 'row' }, h('label', { class: 'check' }, shadowIn, 'ស្រមោល'), h('label', { class: 'check' }, scrimIn, 'ផ្ទៃងងឹតស្រាលក្រោយអក្សរ'))),
    h('div', { class: 'card stack' }, h('h3', null, 'រក្សាទុក / ទាញយក'), field('ផ្ទៃខាងក្រោយ MV', mvUse),
      h('div', { class: 'row' }, saveBtn, dlBtn, dlPlainBtn), h('h4', null, 'រូបគម្របដែលបានរក្សាទុក'), savedBox),
    h('div', null, h('a', { class: 'btn primary', href: `#/p/${pid}/karaoke` }, 'បន្ទាប់៖ MV ខារ៉ាអូខេ →'))));

  drawAspect(); syncControls(); drawSaved();
  await ensureFonts(); await loadImageFor(st); redraw();
  const onResize = () => redraw();
  window.addEventListener('resize', onResize);
  return async () => { window.removeEventListener('resize', onResize); };
}
