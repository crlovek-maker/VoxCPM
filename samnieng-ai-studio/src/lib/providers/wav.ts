/** Tiny procedural synth used only by demo mode: a plain instrumental placeholder, no vocals. */
export interface DemoOptions {
  seconds: number;
  bpm: number;
  minor: boolean;
  energy: "soft" | "mid" | "high";
}

const SR = 22050;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export function synthDemoWav({ seconds, bpm, minor, energy }: DemoOptions): Buffer {
  const total = Math.floor(seconds * SR);
  const buf = new Float32Array(total);
  const beat = 60 / bpm;
  const roots = minor ? [57, 53, 60, 55] : [60, 67, 57, 65]; // i–VI–III–VII  /  I–V–vi–IV
  const third = minor ? 3 : 4;
  const add = (t0: number, dur: number, freq: number, amp: number, pluck: boolean) => {
    const s = Math.floor(t0 * SR);
    const n = Math.min(Math.floor(dur * SR), total - s);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const env = pluck ? Math.exp(-t * 4) : Math.min(1, t * 4) * Math.min(1, (dur - t) * 3);
      buf[s + i] += amp * env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
    }
  };
  const bars = Math.ceil(seconds / (beat * 4));
  for (let b = 0; b < bars; b++) {
    const root = roots[b % 4];
    const t = b * beat * 4;
    for (const iv of [0, third, 7]) add(t, beat * 4, midi(root + iv), 0.07, false); // pad
    add(t, beat * 2, midi(root - 12), 0.18, true); // bass
    add(t + beat * 2, beat * 2, midi(root - 12 + 7), 0.14, true);
    const steps = energy === "soft" ? 4 : 8;
    for (let k = 0; k < steps; k++) add(t + (k * beat * 4) / steps, beat, midi(root + 12 + [0, third, 7, 12][k % 4]), 0.1, true); // arpeggio
    if (energy !== "soft")
      for (let k = 0; k < 8; k++) {
        const s = Math.floor((t + k * beat * 0.5) * SR);
        for (let i = 0; i < 600 && s + i < total; i++) buf[s + i] += (Math.random() * 2 - 1) * 0.04 * Math.exp(-i / 120); // hat
      }
  }
  const fade = Math.min(total, SR * 1.5);
  const out = Buffer.alloc(44 + total * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + total * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) {
    const f = i > total - fade ? (total - i) / fade : 1;
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * f * 0.9)) * 32767), 44 + i * 2);
  }
  return out;
}
