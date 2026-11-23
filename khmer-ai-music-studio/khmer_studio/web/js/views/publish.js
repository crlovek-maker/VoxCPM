// Panel 5 — publishing text: description, credits and hashtags for YouTube / Facebook / TikTok (editable, one-click copy).
import { api, errorText } from '../api.js';
import { state, setProject } from '../state.js';
import { h, clear, toast, debounce, copyText, badge } from '../ui.js';

const PLATFORMS = [['youtube', '▶ YouTube'], ['facebook', '📘 Facebook'], ['tiktok', '🎵 TikTok']];
const SOFT = { youtube: { title: 100, description: 5000 }, facebook: { description: 63000 }, tiktok: { description: 2200 } };

export async function renderPublish(root, { project, pid }) {
  let p = project;
  const info = { ...p.publish.info };
  let texts = JSON.parse(JSON.stringify(p.publish.texts || {}));
  let active = 'youtube';
  let includeLyrics = true;

  const savePub = debounce(async () => { try { setProject(p = await api.put(`/api/projects/${pid}/publish`, { info, texts })); } catch (e) { toast(errorText(e), 'bad'); } }, 700);
  const field = (label, el, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), el, hint ? h('span', { class: 'small muted' }, hint) : null);
  const text = (key, ph = '') => { const el = h('input', { type: 'text', value: info[key] || '', placeholder: ph }); el.addEventListener('input', () => { info[key] = el.value; savePub(); }); return el; };

  const aiBox = h('input', { type: 'checkbox', checked: !!info.ai_disclosure }); aiBox.addEventListener('change', () => { info.ai_disclosure = aiBox.checked; savePub(); });
  const lyrBox = h('input', { type: 'checkbox', checked: true }); lyrBox.addEventListener('change', () => { includeLyrics = lyrBox.checked; });
  const output = h('div', { class: 'stack' });

  async function generate() {
    try {
      const r = await api.post(`/api/projects/${pid}/publish/generate`, { info, include_lyrics: includeLyrics });
      texts = r.texts; drawOutput(); toast('បានបង្កើតអត្ថបទ — កែបាន និងចម្លងបានមួយចុច', 'ok');
    } catch (e) { toast(errorText(e), 'bad'); }
  }
  function box(platform, key, label, rows, limit) {
    const val = (texts[platform] || {})[key] || '';
    const ta = h('textarea', { rows, 'aria-label': label });
    ta.value = val;
    const counter = h('div', { class: 'counter' });
    const paint = () => { counter.textContent = `${ta.value.length}${limit ? ` / ${limit}` : ''}`; counter.classList.toggle('over', !!limit && ta.value.length > limit); };
    ta.addEventListener('input', () => { (texts[platform] = texts[platform] || {})[key] = ta.value; paint(); savePub(); });
    paint();
    const copy = h('button', { class: 'sm', type: 'button', onClick: async () => { toast((await copyText(ta.value)) ? `បានចម្លង «${label}» ✓` : 'ចម្លងមិនបាន — សូមជ្រើសអត្ថបទ ហើយចម្លងដោយដៃ', 'ok'); } }, `📋 ចម្លង`);
    return h('div', { class: 'stack' }, h('div', { class: 'row spread' }, h('strong', null, label), copy), ta, counter);
  }
  function drawOutput() {
    clear(output);
    const t = texts[active];
    if (!t) { output.append(h('div', { class: 'card center muted' }, 'ចុច «បង្កើតអត្ថបទ» ខាងលើ ដើម្បីរៀបចំ Description, Credits និង Hashtags។')); return; }
    const tabs = h('div', { class: 'pubtab' }, ...PLATFORMS.map(([id, label]) => h('button', { type: 'button', class: `chip ${id === active ? 'on' : ''}`, onClick: () => { active = id; drawOutput(); } }, label)));
    const soft = SOFT[active] || {};
    output.append(tabs, h('div', { class: 'card stack' },
      active === 'youtube' ? box(active, 'title', 'ចំណងជើង (Title)', 2, soft.title) : null,
      box(active, 'description', 'Description / Caption', active === 'tiktok' ? 8 : 14, soft.description),
      box(active, 'credits', 'Credits', 5), box(active, 'hashtags', 'Hashtags', 2),
      h('div', { class: 'row' }, h('button', { class: 'primary', type: 'button', onClick: async () => { const parts = [active === 'youtube' ? (texts[active].title || '') : '', texts[active].description || ''].filter(Boolean).join('\n\n'); toast((await copyText(parts)) ? 'បានចម្លងអត្ថបទទាំងអស់ ✓' : 'ចម្លងមិនបាន', 'ok'); } }, '📋 ចម្លងទាំងអស់ (មួយចុច)'),
        h('span', { class: 'small muted' }, 'Description រួមបញ្ចូល Credits និង Hashtags រួចហើយ។')),
      h('div', { class: 'note warn small' }, 'វេទិកានីមួយៗមានច្បាប់ផ្ទាល់ខ្លួនអំពីខ្លឹមសារ AI និងកម្មសិទ្ធិបញ្ញា (ឧ. ស្លាក «បង្កើតដោយ AI»)។ សូមពិនិត្យលក្ខខណ្ឌបច្ចុប្បន្នរបស់ YouTube/Facebook/TikTok និងអាជ្ញាបណ្ណម៉ូដែលមុនបង្ហោះ។')));
  }

  const v = state.project && state.project.versions.find((x) => x.id === state.project.selected_version_id);
  root.append(h('div', { class: 'stack' },
    v ? h('div', { class: 'note' }, 'បទដែលបានជ្រើស៖ ', h('strong', null, v.label), ' · ', v.engine.is_ai ? badge('AI · ' + v.engine.name, 'ai') : badge(v.engine.name, 'notai'), v.engine.is_ai ? null : h('div', { class: 'small' }, 'កំណែនេះមិនមែនជាលទ្ធផល AI ទេ — Credits នឹងមិនអះអាងថាប្រើ AI។')) : h('div', { class: 'note warn' }, 'មិនទាន់ជ្រើសកំណែបទ — Credits នឹងមិនបញ្ជាក់ម៉ូដែល។'),
    h('section', { class: 'card stack' }, h('h3', null, 'ព័ត៌មានបទ'),
      h('div', { class: 'small muted' }, 'ចំណងជើង និងឈ្មោះសិល្បករ ត្រូវបានយកពីផ្នែកខាងលើនៃគម្រោង។'),
      h('div', { class: 'grid2' }, field('ប្រភេទ (Genre)', text('genre', 'ឧ. បាឡាដ')), field('អារម្មណ៍ (Mood)', text('mood', 'ឧ. ស្រទន់')), field('ភាសា', text('language')), field('ឆ្នាំ', text('year', '2026')),
        field('អ្នកនិពន្ធទំនុក', text('lyrics_by', p.artist || '')), field('អ្នកនិពន្ធភ្លេង', text('music_by', p.artist || '')), field('សំឡេងច្រៀង', text('vocals_by', 'ទទេ = AI ឬសិល្បករ')), field('Hashtag បន្ថែម', text('extra_tags', 'ឧ. ស្នេហា, ចម្រៀងថ្មី'))),
      field('តំណ (Links)', text('links', 'https://…')),
      h('label', { class: 'check' }, aiBox, 'ដាក់សេចក្ដីថ្លែងថាបទនេះបង្កើតដោយជំនួយ AI (បញ្ចូលឈ្មោះម៉ូដែល និងអាជ្ញាបណ្ណ)'),
      h('label', { class: 'check' }, lyrBox, 'ដាក់ទំនុកទាំងមូលក្នុង Description'),
      h('div', null, h('button', { class: 'primary big', type: 'button', onClick: generate }, '✨ បង្កើតអត្ថបទ'))),
    output));
  drawOutput();
  return async () => { await savePub.flush(); };
}
