import type { Capabilities, FieldError, OutputMode, PresetId, SectionVoice, SongInput, VocalMode } from "./types";
import { parseLyrics } from "./lyrics";
import { PRESETS, VOICE_DIRECTIONS } from "./presets";

export const LIMITS = { title: 120, lyrics: 6000, line: 200, lines: 200, style: 1500, hint: 200, hints: 100, voiceCustom: 200 };

const VOCAL: VocalMode[] = ["male", "female", "duet"];
const OUTPUT: OutputMode[] = ["full", "instrumental", "vocals"];
const SECVOICE: SectionVoice[] = ["male", "female", "both"];
const PRESET_IDS: PresetId[] = [...PRESETS.map((p) => p.id), "custom"];

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** Coerce untrusted JSON into a SongInput (never throws; unknown values fall back to defaults). */
export function coerceInput(raw: unknown): SongInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  const sv: Record<string, SectionVoice> = {};
  if (o.sectionVoices && typeof o.sectionVoices === "object")
    for (const [k, v] of Object.entries(o.sectionVoices as object))
      if (/^\d{1,3}$/.test(k) && SECVOICE.includes(v as SectionVoice)) sv[k] = v as SectionVoice;
  const hints: Record<string, string> = {};
  if (o.hints && typeof o.hints === "object")
    for (const [k, v] of Object.entries(o.hints as object)) if (typeof v === "string" && v.trim()) hints[k.trim()] = v.trim();
  const t = o.targetSeconds;
  return {
    title: str(o.title).trim(),
    lyrics: str(o.lyrics).replace(/\r\n?/g, "\n"),
    presetId: pick(o.presetId, PRESET_IDS, "custom"),
    stylePrompt: str(o.stylePrompt).trim(),
    vocalMode: pick(o.vocalMode, VOCAL, "female"),
    voiceDirection: str(o.voiceDirection, "custom"),
    voiceCustom: str(o.voiceCustom).trim(),
    sectionVoices: sv,
    outputMode: pick(o.outputMode, OUTPUT, "full"),
    targetSeconds: typeof t === "number" && Number.isFinite(t) ? Math.round(t) : null,
    hints,
    sendHints: o.sendHints === true,
    naturalSinging: o.naturalSinging !== false,
  };
}

const err = (field: string, key: string, message: string, params?: FieldError["params"]): FieldError => ({ field, key, message, params });

/** Shared by client and server. Keys are localized in the UI; `message` is the English fallback. */
export function validateInput(input: SongInput, caps: Pick<Capabilities, "minSeconds" | "maxSeconds" | "vocalsOnly" | "instrumental">): FieldError[] {
  const e: FieldError[] = [];
  if (!input.title) e.push(err("title", "v.title.required", "Enter a song title."));
  else if (input.title.length > LIMITS.title) e.push(err("title", "v.title.long", `Title is too long (max ${LIMITS.title}).`, { max: LIMITS.title }));

  if (input.outputMode === "instrumental" && !caps.instrumental) e.push(err("outputMode", "v.output.instrumentalUnavailable", "This provider cannot make instrumentals."));
  if (input.outputMode === "vocals" && !caps.vocalsOnly) e.push(err("outputMode", "v.output.vocalsUnavailable", "Isolated vocals are not available with this provider."));

  const needsLyrics = input.outputMode !== "instrumental";
  if (needsLyrics && !input.lyrics.trim()) e.push(err("lyrics", "v.lyrics.required", "Enter or paste lyrics."));
  if (input.lyrics.length > LIMITS.lyrics) e.push(err("lyrics", "v.lyrics.long", `Lyrics are too long (max ${LIMITS.lyrics} characters).`, { max: LIMITS.lyrics }));
  const sections = parseLyrics(input.lyrics);
  const lines = sections.flatMap((s) => s.lines);
  if (lines.length > LIMITS.lines) e.push(err("lyrics", "v.lyrics.tooManyLines", `Too many lines (max ${LIMITS.lines}).`, { max: LIMITS.lines }));
  const longIdx = lines.findIndex((l) => [...l].length > LIMITS.line);
  if (longIdx >= 0) e.push(err("lyrics", "v.lyrics.lineLong", `Line ${longIdx + 1} is longer than ${LIMITS.line} characters.`, { n: longIdx + 1, max: LIMITS.line }));

  if (input.presetId === "custom" && !input.stylePrompt) e.push(err("stylePrompt", "v.style.required", "Pick a preset or describe the sound."));
  if (!input.stylePrompt && input.presetId !== "custom") e.push(err("stylePrompt", "v.style.required", "Pick a preset or describe the sound."));
  if (input.stylePrompt.length > LIMITS.style) e.push(err("stylePrompt", "v.style.long", `Style prompt is too long (max ${LIMITS.style}).`, { max: LIMITS.style }));
  if (input.voiceCustom.length > LIMITS.voiceCustom) e.push(err("voiceCustom", "v.voice.long", `Voice description is too long (max ${LIMITS.voiceCustom}).`, { max: LIMITS.voiceCustom }));
  if (input.voiceDirection !== "custom" && !VOICE_DIRECTIONS.some((v) => v.id === input.voiceDirection)) e.push(err("voiceDirection", "v.voice.unknown", "Unknown voice direction."));

  if (input.targetSeconds !== null && (input.targetSeconds < caps.minSeconds || input.targetSeconds > caps.maxSeconds))
    e.push(err("targetSeconds", "v.length.range", `Length must be ${caps.minSeconds}–${caps.maxSeconds} seconds.`, { min: caps.minSeconds, max: caps.maxSeconds }));

  const hintEntries = Object.entries(input.hints);
  if (hintEntries.length > LIMITS.hints) e.push(err("hints", "v.hints.many", `Too many pronunciation hints (max ${LIMITS.hints}).`, { max: LIMITS.hints }));
  if (hintEntries.some(([, v]) => v.length > LIMITS.hint)) e.push(err("hints", "v.hints.long", `A hint is longer than ${LIMITS.hint} characters.`, { max: LIMITS.hint }));
  return e;
}
