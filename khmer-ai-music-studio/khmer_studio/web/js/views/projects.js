// Home: list of projects (one project = one song) + "new project".
import { api, errorText } from '../api.js';
import { state } from '../state.js';
import { h, clear, modal, confirmDialog, toast, fmtDate, badge } from '../ui.js';

export const SAMPLE_LYRICS = `[Chorus]
ខ្ញុំស្រឡាញ់ស្រុកខ្មែរ ដូចបេះដូងខ្ញុំ
ទឹកដីដូនតា ភ្លឺថ្លាគ្រប់ពេល
ចម្រៀងនេះសូមឮ ក្នុងចិត្តជានិច្ច
ស្រុកខ្មែរអើយ ខ្ញុំនៅទីនេះ`;

function newProjectDialog(onCreated) {
  const title = h('input', { type: 'text', placeholder: 'ចំណងជើងបទ (អាចបំពេញពេលក្រោយ)', maxlength: 200 });
  const artist = h('input', { type: 'text', placeholder: 'ឈ្មោះសិល្បករ (អាចបំពេញពេលក្រោយ)', maxlength: 200 });
  const lyrics = h('textarea', { id: 'np-lyrics', placeholder: 'បិទភ្ជាប់ទំនុកនៅទីនេះ (ជម្រើស) — ឧ. [Verse] … [Chorus] …', rows: 7 });
  const sample = h('button', { type: 'button', class: 'sm', onClick: () => { lyrics.value = SAMPLE_LYRICS; if (!title.value) title.value = 'ស្រុកខ្មែរអើយ'; } }, 'ប្រើទំនុកគំរូ ៤ បន្ទាត់');
  const body = h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'ចំណងជើង'), title),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'សិល្បករ'), artist),
    h('div', { class: 'row spread' }, h('label', { class: 'small muted', for: 'np-lyrics' }, 'ទំនុក (ជម្រើស)'), sample),
    lyrics,
    h('p', { class: 'small muted' }, 'ទំនុកគំរូត្រូវបានព្រាងដោយ AI — សូមឱ្យអ្នកចេះភាសាខ្មែរពិនិត្យមុនចេញផ្សាយ។'));
  modal({
    title: 'គម្រោងថ្មី', body,
    actions: [
      { label: 'បោះបង់' },
      { label: 'បង្កើតគម្រោង', class: 'primary', onClick: async () => {
        try {
          const p = await api.post('/api/projects', { title: title.value, artist: artist.value, lyrics_text: lyrics.value || null });
          onCreated(p);
        } catch (e) { toast(errorText(e), 'bad'); return false; }
      } },
    ],
  });
  setTimeout(() => title.focus(), 50);
}

export async function renderProjects(main) {
  const box = h('div', { class: 'container stack' });
  main.append(box);
  const list = h('div', { class: 'plist' });
  const banner = h('div');

  const draw = async () => {
    let data;
    try { data = await api.get('/api/projects'); } catch (e) { clear(list); list.append(h('div', { class: 'note bad' }, errorText(e))); return; }
    clear(list);
    if (!data.projects.length) {
      list.append(h('div', { class: 'card center stack', style: { gridColumn: '1/-1' } },
        h('div', { style: { fontSize: '2.4rem' } }, '🎶'),
        h('p', null, 'មិនទាន់មានគម្រោងទេ។ ចុច «គម្រោងថ្មី» ដើម្បីចាប់ផ្ដើមពីទំនុកខ្លួនឯង។'),
        h('div', null, h('button', { class: 'primary big', onClick: () => newProjectDialog((p) => { location.hash = `#/p/${p.id}/lyrics`; }) }, '＋ គម្រោងថ្មី'))));
      return;
    }
    for (const p of data.projects) {
      const del = h('button', { class: 'sm danger', type: 'button', 'aria-label': 'លុប', onClick: async (ev) => {
        ev.stopPropagation();
        if (await confirmDialog(`លុបគម្រោង «${p.title || 'គ្មានចំណងជើង'}»? ឯកសារសំឡេង រូបភាព និងវីដេអូទាំងអស់នឹងបាត់ជាអចិន្ត្រៃយ៍។`, { ok: 'លុប', danger: true })) {
          try { await api.del(`/api/projects/${p.id}`); draw(); } catch (e) { toast(errorText(e), 'bad'); }
        }
      } }, '🗑 លុប');
      const card = h('div', { class: 'card pcard', role: 'link', tabindex: 0, onClick: () => { location.hash = `#/p/${p.id}/lyrics`; },
        onKeydown: (e) => { if (e.key === 'Enter') location.hash = `#/p/${p.id}/lyrics`; } },
        h('h3', null, p.title || 'គ្មានចំណងជើង'),
        h('div', { class: 'muted' }, p.artist || 'គ្មានឈ្មោះសិល្បករ'),
        h('div', { class: 'row' }, badge(`${p.line_count} បន្ទាត់`), badge(`${p.version_count} កំណែបទ`, p.version_count ? 'ok' : ''), p.has_cover ? badge('រូបគម្រប', 'ok') : null, p.mv_count ? badge(`${p.mv_count} MV`, 'ok') : null),
        h('div', { class: 'small muted' }, 'កែចុងក្រោយ: ', fmtDate(p.updated_at)),
        h('div', { class: 'row spread' }, h('span', { class: 'small', style: { color: 'var(--accent)' } }, 'បើក →'), del));
      list.append(card);
    }
  };

  const hl = state.health;
  const ai = hl && hl.engines.find((e) => e.is_ai);
  if (hl && ai && !ai.health.ok) {
    banner.append(h('div', { class: 'note warn' }, h('strong', null, 'ម៉ូដែល AI មិនទាន់ភ្ជាប់: '), ai.health.message, '។ អ្នកនៅតែសរសេរទំនុក ធ្វើរូបគម្រប និង MV បាន — តែការបង្កើតបទត្រូវការ server ម៉ូដែល (មើល README)។ ចុចប៊ូតុងស្ថានភាពនៅខាងលើដើម្បីមើលព័ត៌មាន។'));
  }
  box.append(
    h('div', { class: 'row spread' }, h('h1', null, 'គម្រោងរបស់ខ្ញុំ'), h('button', { class: 'primary', onClick: () => newProjectDialog((p) => { location.hash = `#/p/${p.id}/lyrics`; }) }, '＋ គម្រោងថ្មី')),
    h('p', { class: 'muted' }, 'មួយបទ = មួយគម្រោង។ អ្នកអាចបិទ ហើយបើកមកកែបន្តវិញបានគ្រប់ពេល។'),
    banner, list);
  await draw();
  return null;
}
