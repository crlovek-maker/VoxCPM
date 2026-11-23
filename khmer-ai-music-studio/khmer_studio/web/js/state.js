// Shared app state + a tiny event bus.
import { api } from './api.js';

export const state = { auth: null, health: null, presets: null, project: null };

const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(name, h); return () => bus.removeEventListener(name, h); };

export async function refreshHealth(force = false) {
  state.health = await api.get('/api/health' + (force ? '?refresh=1' : ''));
  emit('health', state.health);
  return state.health;
}

export async function loadPresets() {
  if (!state.presets) state.presets = await api.get('/api/presets');
  return state.presets;
}

export async function loadProject(pid) {
  state.project = await api.get(`/api/projects/${pid}`);
  emit('project', state.project);
  return state.project;
}

/** Call after an API request that returned the updated project. */
export function setProject(p) {
  state.project = p;
  emit('project', p);
  return p;
}

export function selectedVersion(p = state.project) {
  return p ? p.versions.find((v) => v.id === p.selected_version_id) || null : null;
}

export function engineInfo(id) {
  return state.health ? state.health.engines.find((e) => e.id === id) || null : null;
}
