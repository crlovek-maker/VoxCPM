// "What model is this, what are its terms, does it support Khmer?" — shown in the header chip and the music tab.
import { h, badge } from '../ui.js';

const KHMER_LABEL = {
  documented: ['ឯកសារបញ្ជាក់ថាគាំទ្រភាសាខ្មែរ', 'ok'],
  not_documented: ['ឯកសារមិនបញ្ជាក់ភាសាខ្មែរ → ត្រូវសាកល្បងបន្ថែម', 'warn'],
  none: ['មិនគាំទ្រភាសាខ្មែរ', 'bad'],
  not_ai: ['មិនពាក់ព័ន្ធ (មិនមែន AI)', ''],
  unknown: ['មិនដឹង', ''],
};

export function engineCard(e, { open = false } = {}) {
  const [klabel, kkind] = KHMER_LABEL[e.khmer_status] || KHMER_LABEL.unknown;
  const row = (k, v) => v ? h('div', null, h('strong', null, k + ': '), v) : null;
  const link = (u) => u ? h('a', { href: u, target: '_blank', rel: 'noopener' }, u) : null;
  return h('details', { open },
    h('summary', null, h('strong', null, e.name), ' ', e.is_ai ? badge('AI', 'ai') : badge('មិនមែន AI', 'notai'), ' ', e.experimental ? badge('ពិសោធន៍ · មិនទាន់សាកល្បង', 'warn') : null, ' ',
      badge(e.health.ok ? e.health.message : (e.health.message || 'មិនរួចរាល់'), e.health.ok ? 'ok' : 'bad')),
    h('div', { class: 'stack small', style: { padding: '6px 0 10px' } },
      h('div', null, e.summary),
      row('គេហទំព័រផ្លូវការ', link(e.homepage)), row('ទម្ងន់ម៉ូដែល (ទាញយក)', link(e.weights_url)),
      row('អាជ្ញាបណ្ណ', e.license_name ? h('span', null, e.license_name, ' ', link(e.license_url)) : null),
      row('លក្ខខណ្ឌចេញផ្សាយបទ', e.release_terms), row('តម្រូវការ GPU/VRAM', e.hardware),
      h('div', null, h('strong', null, 'ភាសាខ្មែរ: '), badge(klabel, kkind), h('div', { class: 'muted' }, e.khmer_note)),
      h('div', null, h('strong', null, 'ការគាំទ្រ: '), e.supports_vocals ? '✓ សំឡេងច្រៀង ' : '✗ គ្មានសំឡេងច្រៀង ', e.supports_instrumental ? '✓ ភ្លេងសុទ្ធ' : '✗ ភ្លេងសុទ្ធ'),
      (e.notes || []).length ? h('ul', { class: 'muted', style: { margin: 0, paddingLeft: '1.2em' } }, ...e.notes.map((n) => h('li', null, n))) : null,
      e.health.detail && e.health.detail.url ? h('div', { class: 'muted mono' }, e.health.detail.url) : null));
}

export function engineInfoBody(health) {
  const box = h('div', { class: 'stack' });
  const f = health.ffmpeg;
  box.append(h('div', { class: 'note' + (f.ok && f.has_ass ? ' ok' : ' bad') },
    h('strong', null, 'FFmpeg: '), f.ok ? (f.has_ass ? '✓ មាន (គាំទ្រអក្សរខ្មែរក្នុង MV)' : '✗ មិនមាន libass — MV បង្ហាញអក្សរខ្មែរមិនបាន') : '✗ រកមិនឃើញ — ត្រូវដំឡើង', ' · ពុម្ពអក្សរ: ', health.fonts.length ? '✓' : '✗'));
  health.engines.forEach((e, i) => box.append(h('div', { class: 'card flat' }, engineCard(e, { open: i === 0 }))));
  box.append(h('div', { class: 'note' }, h('strong', null, 'ម៉ូដែលអត្ថបទ (ជំនួយទំនុក): '), health.llm.message));
  return box;
}
