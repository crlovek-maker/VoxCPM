// Custom audio player: native <audio> is not controllable enough (karaoke tapping, A/B compare, iOS quirks).
import { h, fmtDuration } from './ui.js';

const all = new Set();
window.__kmPlayers = all; // read-only hook used by the end-to-end browser test (tests/e2e) to check real playback

export function pauseAllExcept(keep) {
  for (const p of all) if (p.audio !== keep && !p.audio.paused) p.audio.pause();
}

export function createPlayer(src, { onPlay, onPause, onEnded } = {}) {
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.setAttribute('playsinline', '');
  audio.src = src;
  const btn = h('button', { class: 'pp', type: 'button', 'aria-label': 'ចាក់ / ផ្អាក' }, '▶');
  const range = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'ទីតាំងក្នុងបទ' });
  const time = h('span', { class: 't' }, '0:00 / 0:00');
  const el = h('div', { class: 'player' }, btn, range, time);
  let raf = 0; let dragging = false;

  const dur = () => (Number.isFinite(audio.duration) ? audio.duration : 0);
  const paint = () => {
    if (!dragging && dur()) range.value = String(Math.round((audio.currentTime / dur()) * 1000));
    time.textContent = `${fmtDuration(audio.currentTime)} / ${fmtDuration(dur())}`;
  };
  const loop = () => { paint(); if (!audio.paused) raf = requestAnimationFrame(loop); };

  btn.addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
  range.addEventListener('input', () => { dragging = true; if (dur()) audio.currentTime = (range.value / 1000) * dur(); paint(); });
  range.addEventListener('change', () => { dragging = false; });
  audio.addEventListener('play', () => { pauseAllExcept(audio); btn.textContent = '❚❚'; cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); if (onPlay) onPlay(); });
  audio.addEventListener('pause', () => { btn.textContent = '▶'; paint(); if (onPause) onPause(); });
  audio.addEventListener('ended', () => { btn.textContent = '▶'; paint(); if (onEnded) onEnded(); });
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('durationchange', paint);
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('error', () => { time.textContent = 'ចាក់មិនបាន'; });

  const api = {
    el, audio,
    play: () => audio.play().catch(() => {}),
    pause: () => audio.pause(),
    seek: (t) => { audio.currentTime = Math.max(0, t); paint(); },
    get time() { return audio.currentTime; },
    get duration() { return dur(); },
    destroy: () => { audio.pause(); audio.removeAttribute('src'); audio.load(); all.delete(api); cancelAnimationFrame(raf); },
  };
  all.add(api);
  return api;
}
