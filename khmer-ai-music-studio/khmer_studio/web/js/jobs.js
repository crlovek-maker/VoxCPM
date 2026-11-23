// Job tracking: polls the server for the REAL status of every active job and renders it.
import { api, errorText } from './api.js';
import { emit } from './state.js';
import { h, badge, fmtDuration, spinner, clear } from './ui.js';

const tracked = new Map(); // id -> { job, listeners:Set }
let timer = null;
let offset = 0; // serverTime - clientTime (ms)

export const isActive = (j) => j && (j.status === 'queued' || j.status === 'running');
export const activeCount = () => [...tracked.values()].filter((t) => isActive(t.job)).length;

export function trackJob(job, listener) {
  let entry = tracked.get(job.id);
  if (!entry) { entry = { job, listeners: new Set() }; tracked.set(job.id, entry); }
  if (listener) { entry.listeners.add(listener); listener(entry.job); }
  entry.job = job;
  emit('jobs-changed', { count: activeCount() });
  start();
  return () => entry.listeners.delete(listener);
}

function start() {
  if (timer) return;
  timer = setInterval(tick, 1000);
}

async function tick() {
  const live = [...tracked.values()].filter((t) => isActive(t.job));
  if (!live.length) { clearInterval(timer); timer = null; return; }
  await Promise.all(live.map(async (entry) => {
    try {
      const job = await api.get(`/api/jobs/${entry.job.id}`);
      if (job.server_now) offset = Date.parse(job.server_now) - Date.now();
      const wasActive = isActive(entry.job);
      entry.job = job;
      entry.listeners.forEach((fn) => fn(job));
      if (wasActive && !isActive(job)) {
        emit('job-finished', job);
        emit('jobs-changed', { count: activeCount() });
      }
    } catch (e) {
      // keep the last known state; the card shows a "connection lost" hint after a few failures
      entry.failures = (entry.failures || 0) + 1;
      if (entry.failures >= 3) entry.listeners.forEach((fn) => fn({ ...entry.job, _conn_lost: errorText(e) }));
    }
  }));
}

/** On page load: re-attach to jobs that were running before the page was refreshed. */
export async function watchProject(pid) {
  const { jobs } = await api.get(`/api/projects/${pid}/jobs`);
  jobs.filter(isActive).forEach((j) => trackJob(j));
  return jobs;
}

export function latestJob(jobs, kinds) {
  return jobs.find((j) => kinds.includes(j.kind)) || null;
}

const STATUS = {
  queued: ['រង់ចាំក្នុងជួរ', 'warn'], running: ['កំពុងដំណើរការ', 'warn'], succeeded: ['ជោគជ័យ', 'ok'], failed: ['បរាជ័យ', 'bad'], cancelled: ['បានបោះបង់', ''],
};

/** A reusable card showing a job's true state. `set(job)` updates it in place. */
export function makeJobCard({ onRetry, onCancel, onSuccess } = {}) {
  const title = h('strong');
  const stat = badge('');
  const msg = h('div');
  const barFill = h('i');
  const bar = h('div', { class: 'bar' }, barFill);
  const meta = h('div', { class: 'small muted' });
  const err = h('div', { class: 'hidden' });
  const logBox = h('div', { class: 'log mono muted' });
  const logWrap = h('details', null, h('summary', null, 'កំណត់ហេតុការងារ (log)'), logBox);
  const cancelBtn = h('button', { class: 'sm danger', type: 'button' }, 'បោះបង់ការងារ');
  const retryBtn = h('button', { class: 'sm primary hidden', type: 'button' }, 'ព្យាយាមម្ដងទៀត');
  const extra = h('div');
  const el = h('div', { class: 'job hidden', 'aria-live': 'polite' },
    h('div', { class: 'row spread' }, h('div', { class: 'row' }, spinner(), title), stat),
    msg, bar, meta, err, extra, logWrap, h('div', { class: 'row' }, cancelBtn, retryBtn));
  const spin = el.querySelector('.spinner');
  let job = null; let ticker = null; let succeededHandled = null;

  cancelBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    try { const j = await api.post(`/api/jobs/${job.id}/cancel`); trackJob(j); card.set(j); if (onCancel) onCancel(j); } catch { cancelBtn.disabled = false; }
  });
  retryBtn.addEventListener('click', () => onRetry && onRetry(job));

  function elapsed() {
    if (!job) return '';
    const t0 = Date.parse(job.started_at || job.created_at);
    const t1 = isActive(job) ? Date.now() + offset : Date.parse(job.finished_at || job.server_now || new Date().toISOString());
    return fmtDuration(Math.max(0, (t1 - t0) / 1000));
  }
  function paintMeta() {
    if (!job) return;
    const parts = [];
    if (job.params && job.params.engine_name) parts.push(job.params.engine_name);
    parts.push(`ពេលវេលា ${elapsed()}`);
    if (job.status === 'queued' && job.queue_position) parts.push(`លំដាប់ក្នុងជួរ: ${job.queue_position}`);
    meta.textContent = parts.join(' · ');
  }

  const card = {
    el,
    set(j) {
      job = j;
      el.dataset.jobId = j.id;
      el.classList.remove('hidden', 'running', 'succeeded', 'failed');
      if (j.status === 'running') el.classList.add('running');
      if (j.status === 'succeeded') el.classList.add('succeeded');
      if (j.status === 'failed') el.classList.add('failed');
      const [label, kind] = STATUS[j.status] || [j.status, ''];
      title.textContent = j.label || j.kind;
      stat.textContent = label; stat.className = `badge ${kind}`;
      msg.textContent = j._conn_lost ? `បាត់ការតភ្ជាប់ទៅ server (${j._conn_lost}) — កំពុងព្យាយាមម្ដងទៀត…` : (j.message || '');
      const active = isActive(j);
      spin.classList.toggle('hidden', !active);
      bar.classList.toggle('indet', active && (j.progress === null || j.progress === undefined || j.status === 'queued'));
      barFill.style.width = j.status === 'succeeded' ? '100%' : (active && j.progress != null && j.status !== 'queued' ? `${Math.round(j.progress * 100)}%` : '');
      bar.classList.toggle('hidden', !active && j.status !== 'succeeded');
      cancelBtn.classList.toggle('hidden', !active); cancelBtn.disabled = !!j.cancel_requested;
      retryBtn.classList.toggle('hidden', !(onRetry && (j.status === 'failed' || j.status === 'cancelled')));
      clear(logBox);
      (j.log || []).slice(-40).forEach((l) => logBox.append(h('div', null, `${(l.t || '').slice(11, 19)}  ${l.msg}`)));
      logWrap.classList.toggle('hidden', !(j.log || []).length);
      clear(err);
      if (j.status === 'failed' && j.error) {
        err.classList.remove('hidden');
        err.append(h('div', { class: 'note bad' },
          h('strong', null, j.error.message),
          j.error.hint ? h('div', null, '💡 ', j.error.hint) : null,
          j.error.detail ? h('details', null, h('summary', null, 'ព័ត៌មានបច្ចេកទេស'), h('div', { class: 'mono' }, j.error.detail)) : null));
      } else err.classList.add('hidden');
      paintMeta();
      if (active && !ticker) ticker = setInterval(paintMeta, 500);
      if (!active && ticker) { clearInterval(ticker); ticker = null; }
      if (j.status === 'succeeded' && succeededHandled !== j.id) { succeededHandled = j.id; if (onSuccess) onSuccess(j, extra); }
    },
    clear() { job = null; delete el.dataset.jobId; el.classList.add('hidden'); },
    get job() { return job; },
    extra,
  };
  return card;
}
