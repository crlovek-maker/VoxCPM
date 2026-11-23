// Small DOM helpers (no framework): hyperscript, toasts, modal, confirm, clipboard, formatting.

// The native Element.append() turns `null`/`undefined`/`false` into the TEXT "null"/"undefined"/"false".
// All our view code uses the convention "falsy child = nothing" (like h() below), so make append() follow it.
const nativeAppend = Element.prototype.append;
Element.prototype.append = function append(...nodes) {
  return nativeAppend.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false));
};

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'multiple', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); return fn(...a); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

// ---------- Khmer numerals / time ----------
const KM_DIGITS = '០១២៣៤៥៦៧៨៩';
export const kmNum = (n) => String(n).replace(/[0-9]/g, (d) => KM_DIGITS[d]);

export function fmtTime(sec, decimals = 1) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '';
  const neg = sec < 0; sec = Math.abs(sec);
  const m = Math.floor(sec / 60); const s = sec - m * 60;
  return `${neg ? '-' : ''}${m}:${s.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0')}`;
}
export function parseTime(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 60 : 0) + parseFloat(m[2]);
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
/** Khmer date written by hand ("២៣ វិច្ឆិកា ២០២៦ · ០៣:១៣"): browsers' km-KH data is incomplete (e.g. prints "M11"). */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const two = (n) => String(n).padStart(2, '0');
  return kmNum(`${d.getDate()} ${KM_MONTHS[d.getMonth()]} ${d.getFullYear()} · ${two(d.getHours())}:${two(d.getMinutes())}`);
}
export function fmtBytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return Math.round(n / 1e3) + ' KB';
}

// ---------- toasts ----------
export function toast(message, kind = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind === 'info' ? '' : kind}` }, message);
  box.append(el);
  const kill = () => el.remove();
  if (ms) setTimeout(kill, ms);
  el.addEventListener('click', kill);
  return { close: kill, el };
}

// ---------- modal ----------
export function modal({ title, body, actions = [], onClose, wide = false } = {}) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: 'modal', style: wide ? { maxWidth: '900px' } : {} });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  if (title) box.append(h('h2', null, title));
  box.append(body instanceof Node ? body : h('div', null, body));
  if (actions.length) {
    const bar = h('div', { class: 'actions' });
    for (const a of actions) {
      bar.append(h('button', { class: a.class || '', onClick: async (e) => { const r = a.onClick ? await a.onClick(e, close) : undefined; if (a.close !== false && r !== false) close(); } }, a.label));
    }
    box.append(bar);
  }
  overlay.append(box);
  document.body.append(overlay);
  return { close, box };
}

export function confirmDialog(message, { ok = 'យល់ព្រម', cancel = 'បោះបង់', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    modal({
      title, body: h('p', null, message), onClose: () => finish(false),
      actions: [
        { label: cancel, onClick: () => finish(false) },
        { label: ok, class: danger ? 'danger' : 'primary', onClick: () => finish(true) },
      ],
    });
  });
}

// ---------- clipboard (navigator.clipboard needs HTTPS; fall back for http://192.168.x.x) ----------
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  const ta = h('textarea', { style: { position: 'fixed', top: '0', left: '0', opacity: '0', width: '1px', height: '1px' }, readonly: true });
  ta.value = text;
  document.body.append(ta);
  ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function triggerDownload(url, filename) {
  const a = h('a', { href: url, download: filename || '' });
  document.body.append(a); a.click(); a.remove();
}

export function autoGrow(textarea, min = 96) {
  const fit = () => { textarea.style.height = 'auto'; textarea.style.height = Math.max(min, textarea.scrollHeight + 2) + 'px'; };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }
export function spinner() { return h('span', { class: 'spinner', 'aria-hidden': 'true' }); }
