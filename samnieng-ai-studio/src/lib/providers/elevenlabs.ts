import { AppError } from "../errors";
import type { Capabilities } from "../types";
import type { GenerationRequest } from "../generation";
import type { GenerateContext, MusicProvider, ProviderOutput } from "./types";

/**
 * ElevenLabs Music API adapter (POST /v1/music).
 *
 * Request shapes follow ElevenLabs' public documentation as recalled when this adapter
 * was written. They have NOT been exercised against the live service from the build
 * environment (outbound access to api.elevenlabs.io was unavailable), so run
 * `npm run live-check` with a real key before relying on it.
 */
export class ElevenLabsProvider implements MusicProvider {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs Music";
  readonly mode = "live" as const;

  constructor(private env: Record<string, string | undefined> = process.env) {}

  private get key() {
    return this.env.ELEVENLABS_API_KEY?.trim() ?? "";
  }
  private get base() {
    return (this.env.ELEVENLABS_BASE_URL?.trim() || "https://api.elevenlabs.io").replace(/\/+$/, "");
  }
  private get model() {
    return this.env.ELEVENLABS_MODEL_ID?.trim() || "music_v1";
  }
  private get format() {
    const f = this.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";
    return /^mp3_\d+_\d+$/.test(f) ? f : "mp3_44100_128";
  }
  private get timeoutMs() {
    const n = Number(this.env.ELEVENLABS_TIMEOUT_MS);
    return Number.isFinite(n) && n >= 10_000 ? n : 300_000;
  }

  capabilities(): Capabilities {
    return {
      providerId: this.id,
      label: this.label,
      mode: "live",
      model: this.model,
      sungVocals: true,
      instrumental: true,
      vocalsOnly: false,
      vocalsOnlyReason: "This adapter does not request an a cappella render or a vocal stem, so isolated vocals are unavailable.",
      stems: false,
      sectionVoice: "prompt",
      voiceDirection: "prompt",
      pronunciationHints: "prompt",
      tempoControl: "prompt",
      customVoices: false,
      minSeconds: 3,
      maxSeconds: 600,
      outputFormats: [this.format.split("_")[0]],
      khmerVerified: false,
      notes: [
        "The Music API takes lyrics, a global style list and per-section style lists. There is no voice-ID, per-section singer or phoneme parameter.",
        "Khmer is not among the languages the provider explicitly documents for sung lyrics; treat Khmer results as experimental.",
      ],
    };
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<ProviderOutput> {
    if (!this.key) throw new AppError("MISSING_CREDENTIALS", "ELEVENLABS_API_KEY is not set on the server.", false, 503);

    const body: Record<string, unknown> = { model_id: this.model };
    if (req.kind === "plan" && req.plan) body.composition_plan = req.plan;
    else {
      body.prompt = req.prompt;
      body.music_length_ms = req.musicLengthMs;
      body.force_instrumental = req.forceInstrumental;
    }

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error("timeout")), this.timeoutMs);
    const onAbort = () => timeout.abort(ctx.signal.reason ?? new Error("cancelled"));
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      ctx.onStage("submitting", null);
      let res: Response;
      try {
        res = await fetch(`${this.base}/v1/music?output_format=${encodeURIComponent(this.format)}`, {
          method: "POST",
          headers: { "xi-api-key": this.key, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify(body),
          signal: timeout.signal,
        });
      } catch (e) {
        if (ctx.signal.aborted) throw new AppError("CANCELLED", "Generation was cancelled.", true, 499);
        if (timeout.signal.aborted) throw new AppError("TIMEOUT", `The provider did not finish within ${Math.round(this.timeoutMs / 1000)}s.`, true, 504);
        throw new AppError("NETWORK", `Could not reach the provider: ${e instanceof Error ? e.message : String(e)}`, true, 502);
      }
      ctx.onStage("generating", null);
      if (!res.ok) throw await this.mapError(res);
      let buf: Buffer;
      try {
        buf = Buffer.from(await res.arrayBuffer());
      } catch {
        if (ctx.signal.aborted) throw new AppError("CANCELLED", "Generation was cancelled.", true, 499);
        throw new AppError("TIMEOUT", "The audio download did not finish in time.", true, 504);
      }
      if (buf.length < 1024) throw new AppError("EMPTY_AUDIO", "The provider returned an empty or truncated audio file.", true, 502);
      ctx.onStage("saving", null);
      return { audio: buf, format: "mp3", mime: res.headers.get("content-type")?.split(";")[0] || "audio/mpeg" };
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    }
  }

  private async mapError(res: Response): Promise<AppError> {
    let detail = "";
    try {
      const j = (await res.json()) as { detail?: unknown };
      const d = j.detail as { message?: string; status?: string } | string | undefined;
      detail = typeof d === "string" ? d : d?.message || d?.status || JSON.stringify(j).slice(0, 300);
    } catch {
      /* non-JSON body */
    }
    const s = res.status;
    if (s === 401 || s === 403) return new AppError("PROVIDER_AUTH", `The provider rejected the API key (HTTP ${s}). ${detail}`.trim(), false, 502);
    if (s === 402) return new AppError("PROVIDER_QUOTA", `Provider plan or credits do not allow this request (HTTP 402). ${detail}`.trim(), false, 502);
    if (s === 429) return new AppError("PROVIDER_RATE_LIMIT", `The provider is rate limiting requests. ${detail}`.trim(), true, 502);
    if (s === 400 || s === 422) return new AppError("PROVIDER_REJECTED", `The provider rejected the request (HTTP ${s}). ${detail}`.trim(), false, 502);
    return new AppError("PROVIDER_ERROR", `Provider error (HTTP ${s}). ${detail}`.trim(), s >= 500, 502);
  }
}
