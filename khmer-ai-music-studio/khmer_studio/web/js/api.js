// fetch wrapper: JSON in/out, FormData uploads, Khmer error objects, 401 -> login screen.

export class ApiError extends Error {
  constructor(status, err) {
    super(err.message || 'កំហុស');
    this.status = status; this.code = err.code || 'error'; this.detail = err.detail || null; this.hint = err.hint || null;
  }
}

const listeners = { unauthorized: [] };
export const onUnauthorized = (fn) => listeners.unauthorized.push(fn);

async function request(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, init); } catch (e) {
    throw new ApiError(0, { code: 'network', message: 'មិនអាចភ្ជាប់ទៅ server របស់កម្មវិធីបានទេ — ពិនិត្យថា server នៅដំណើរការ និងបណ្ដាញ Wi-Fi', detail: String(e) });
  }
  if (res.status === 401) listeners.unauthorized.forEach((f) => f());
  if (opts.blob && res.ok) return res.blob();
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = data && data.error ? data.error : { code: `http_${res.status}`, message: `កំហុស HTTP ${res.status}`, detail: typeof data === 'string' ? data.slice(0, 300) : null };
    throw new ApiError(res.status, err);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body === undefined ? {} : body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData),
  blobPost: (url, body) => request('POST', url, body, { blob: true }),
};

export function errorText(e) {
  if (!(e instanceof ApiError)) return String(e && e.message ? e.message : e);
  return e.message + (e.hint ? ` — ${e.hint}` : '');
}
