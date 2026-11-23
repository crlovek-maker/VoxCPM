// Microphone recording. Browsers only allow the mic on HTTPS or localhost — on plain http://192.168.x.x
// (phone -> your PC) `navigator.mediaDevices` is undefined, so we report why instead of failing silently.

export function micStatus() {
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

function pickMime() {
  const wanted = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
  for (const m of wanted) if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
  const started = performance.now();
  rec.start(250);
  return {
    mime: rec.mimeType || mime || 'audio/webm',
    elapsed: () => (performance.now() - started) / 1000,
    stop: () => new Promise((resolve) => {
      rec.addEventListener('stop', () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }));
      }, { once: true });
      rec.stop();
    }),
    cancel: () => { try { rec.stop(); } catch { /* ignore */ } stream.getTracks().forEach((t) => t.stop()); },
  };
}

export function extFor(mime) {
  if (mime.includes('mp4') || mime.includes('aac')) return '.m4a';
  if (mime.includes('ogg')) return '.ogg';
  return '.webm';
}
