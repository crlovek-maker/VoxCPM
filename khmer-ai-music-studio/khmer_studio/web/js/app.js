// App shell: header, router (#/ and #/p/<id>/<tab>), login, engine status chip.
import { api, errorText, onUnauthorized } from './api.js';
import { state, refreshHealth, loadPresets, loadProject, on } from './state.js';
import { activeCount, watchProject } from './jobs.js';
import { h, clear, toast, modal } from './ui.js';
import { renderProjects } from './views/projects.js';
import { renderLyrics } from './views/lyrics.js';
import { renderMusic } from './views/music.js';
import { renderCover } from './views/cover.js';
import { renderKaraoke } from './views/karaoke.js';
import { renderPublish } from './views/publish.js';
import { engineInfoBody } from './views/engine_info.js';

const TABS = [
  ['lyrics', '១', 'ទំនុក', renderLyrics],
  ['music', '២', 'តន្ត្រី', renderMusic],
  ['cover', '៣', 'រូបគម្រប', renderCover],
  ['karaoke', '៤', 'MV ខារ៉ាអូខេ', renderKaraoke],
  ['publish', '៥', 'បង្ហោះ', renderPublish],
];

const root = document.getElementById('app');
let cleanup = null;
let renderToken = 0;
const chip = h('button', { class: 'chip-status', type: 'button', 'aria-label': 'ស្ថានភាពម៉ូដែល' });
const jobsChip = h('span', { class: 'chip-status hidden', title: 'ការងារកំពុងដំណើរការ' });
const main = h('div');

function parseRoute() {
  const m = location.hash.match(/^#\/p\/([^/?]+)(?:\/(\w+))?/);
  return m ? { view: 'project', pid: m[1], tab: TABS.some((t) => t[0] === m[2]) ? m[2] : 'lyrics' } : { view: 'home' };
}
export const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

function paintChip() {
  const hl = state.health;
  if (!hl) { chip.replaceChildren(h('span', { class: 'dot' }), 'កំពុងពិនិត្យ…'); return; }
  const eng = hl.engines.find((e) => e.id === (state.project && state.project.music.engine)) || hl.engines.find((e) => e.id === hl.default_engine) || hl.engines[0];
  const ok = eng && eng.health.ok;
  const kind = ok ? (eng.is_ai ? 'ok' : 'warn') : 'bad';
  // short text (fits an iPhone header); the full model name is in the tooltip and in the info dialog
  const label = !eng ? 'គ្មានម៉ូដែល' : ok ? (eng.is_ai ? 'ម៉ូដែល AI ភ្ជាប់បាន' : 'របៀបសាកល្បង (មិនមែន AI)') : 'ម៉ូដែល AI មិនទាន់ភ្ជាប់';
  chip.title = eng ? `${eng.name} — ${eng.health.message}` : '';
  chip.replaceChildren(h('span', { class: `dot ${kind}` }), label);
}

function buildShell() {
  const header = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icons/icon-192.png', alt: '' }),
        h('div', null, h('b', null, 'Khmer AI Music Studio 5-in-1'), h('span', null, 'ផលិតចម្រៀងខ្មែរ/អង់គ្លេស ដោយ AI លើម៉ាស៊ីនរបស់អ្នក'))),
      h('div', { class: 'grow' }), jobsChip, chip));
  root.replaceChildren(header, main);
  chip.addEventListener('click', async () => {
    try { await refreshHealth(true); } catch { /* shown in chip */ }
    paintChip();
    modal({ title: 'ព័ត៌មានម៉ូដែល និងស្ថានភាព', body: engineInfoBody(state.health), actions: [{ label: 'បិទ', class: 'primary' }], wide: true });
  });
  on('health', paintChip);
  on('project', paintChip);
  on('jobs-changed', ({ count }) => {
    jobsChip.classList.toggle('hidden', !count);
    jobsChip.replaceChildren(h('span', { class: 'dot busy' }), `${count} ការងារ`);
  });
}

function showLogin() {
  clear(main);
  const input = h('input', { type: 'password', placeholder: 'លេខកូដចូល (token)', autocomplete: 'current-password', 'aria-label': 'token' });
  const submit = async () => {
    try { await api.post('/api/login', { token: input.value }); location.reload(); } catch (e) { toast(errorText(e), 'bad'); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  main.append(h('div', { class: 'container' }, h('div', { class: 'card login stack' },
    h('h2', null, '🔒 ត្រូវការលេខកូដចូល'),
    h('p', { class: 'muted' }, 'លេខកូដត្រូវបានបង្ហាញក្នុង terminal ពេលចាប់ផ្ដើមកម្មវិធី (--lan) ឬកំណត់ក្នុង STUDIO_TOKEN។'),
    input, h('button', { class: 'primary big', onClick: submit }, 'ចូល'))));
  input.focus();
}

async function render() {
  const token = ++renderToken;
  if (cleanup) { try { await cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  const route = parseRoute();
  clear(main);
  if (route.view === 'home') {
    state.project = null; paintChip();
    cleanup = await renderProjects(main);
    return;
  }
  main.append(h('div', { class: 'container' }, h('p', { class: 'muted' }, 'កំពុងផ្ទុក…')));
  let project;
  try { project = await loadProject(route.pid); } catch (e) {
    if (token !== renderToken) return;
    clear(main);
    main.append(h('div', { class: 'container' }, h('div', { class: 'note bad' }, errorText(e)), h('p', null, h('a', { href: '#/' }, '← ត្រឡប់ទៅគម្រោង'))));
    return;
  }
  if (token !== renderToken) return;
  watchProject(route.pid).catch(() => {});
  const nav = h('nav', { class: 'nav', 'aria-label': 'ផ្ទាំងការងារ' },
    ...TABS.map(([id, num, label]) => h('a', { href: `#/p/${route.pid}/${id}`, class: id === route.tab ? 'active' : '', 'aria-current': id === route.tab ? 'page' : null },
      h('span', { class: 'num' }, num), h('span', null, label))));
  const title = h('input', { type: 'text', value: project.title, placeholder: 'ចំណងជើងបទ', 'aria-label': 'ចំណងជើងបទ', maxlength: 200 });
  const artist = h('input', { type: 'text', value: project.artist, placeholder: 'ឈ្មោះសិល្បករ', 'aria-label': 'ឈ្មោះសិល្បករ', maxlength: 200 });
  let t = null;
  const saveMeta = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try { const p = await api.patch(`/api/projects/${route.pid}`, { title: title.value, artist: artist.value }); state.project.title = p.title; state.project.artist = p.artist; } catch (e) { toast(errorText(e), 'bad'); }
    }, 600);
  };
  title.addEventListener('input', saveMeta); artist.addEventListener('input', saveMeta);
  const body = h('div');
  clear(main);
  main.append(nav, h('div', { class: 'container' },
    h('div', { class: 'projectbar' }, h('a', { class: 'btn sm back', href: '#/' }, '← គម្រោងទាំងអស់'), title, artist), body));
  const view = TABS.find((x) => x[0] === route.tab)[3];
  try {
    cleanup = await view(body, { project, pid: route.pid, go });
  } catch (e) {
    console.error(e);
    body.append(h('div', { class: 'note bad' }, 'បង្ហាញផ្ទាំងមិនបាន: ', errorText(e)));
  }
  window.scrollTo(0, 0);
}

async function boot() {
  buildShell();
  onUnauthorized(() => showLogin());
  const params = new URLSearchParams(location.search);
  if (params.get('token')) {  // QR code / link carries the token: swap it for a cookie, then clean the URL
    try { await api.post('/api/login', { token: params.get('token') }); } catch { /* wrong token: login screen below */ }
    params.delete('token');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  }
  try { state.auth = await api.get('/api/auth'); } catch (e) { main.append(h('div', { class: 'container' }, h('div', { class: 'note bad' }, errorText(e)))); return; }
  if (state.auth.required && !state.auth.ok) { showLogin(); return; }
  try { await Promise.all([refreshHealth(), loadPresets()]); } catch (e) { toast(errorText(e), 'bad'); }
  paintChip();
  setInterval(() => { if (!document.hidden) refreshHealth().catch(() => {}); }, 15000);
  window.addEventListener('hashchange', render);
  await render();
}

boot();
