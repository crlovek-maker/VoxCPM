import type { Capabilities } from "../types";
import type { GenerationRequest } from "../generation";
import { presetById } from "../presets";
import type { GenerateContext, MusicProvider, ProviderOutput } from "./types";
import { synthDemoWav } from "./wav";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), rej(signal.reason)), { once: true });
  });

/**
 * DEMO MODE. Produces a short procedurally-synthesized instrumental placeholder so the whole
 * workflow (progress, playback, history, download) can be exercised without credentials.
 * It contains NO singing and is NOT derived from the user's lyrics.
 */
export class DemoProvider implements MusicProvider {
  readonly id = "demo";
  readonly label = "Demo mode (sample audio)";
  readonly mode = "demo" as const;

  capabilities(): Capabilities {
    return {
      providerId: this.id,
      label: this.label,
      mode: "demo",
      sungVocals: false,
      instrumental: true,
      vocalsOnly: false,
      vocalsOnlyReason: "Demo mode has no vocals at all.",
      stems: false,
      sectionVoice: "none",
      voiceDirection: "none",
      pronunciationHints: "none",
      tempoControl: "none",
      customVoices: false,
      minSeconds: 3,
      maxSeconds: 600,
      outputFormats: ["wav"],
      khmerVerified: false,
      notes: ["Demo mode returns a synthesized placeholder loop. No singing is generated and the lyrics are not used."],
    };
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<ProviderOutput> {
    ctx.onStage("submitting", 0.05);
    await sleep(700, ctx.signal);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      ctx.onStage("generating", 0.1 + (0.8 * i) / steps);
      await sleep(600, ctx.signal);
    }
    const p = presetById(req.input.presetId);
    const bpm = p ? Math.round((p.bpm[0] + p.bpm[1]) / 2) : 90;
    const minor = !["pop-rock", "edm", "khmer-kentrim"].includes(req.input.presetId);
    const energy = bpm < 85 ? "soft" : bpm > 120 ? "high" : "mid";
    const seconds = Math.min(30, Math.max(12, (req.input.targetSeconds ?? 24) / 4));
    ctx.onStage("saving", 0.95);
    return { audio: synthDemoWav({ seconds, bpm, minor, energy }), format: "wav", mime: "audio/wav" };
  }
}
