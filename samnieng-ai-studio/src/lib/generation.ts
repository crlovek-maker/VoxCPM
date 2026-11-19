import type { Capabilities, ControlReport, SongInput, Support } from "./types";
import { allLyricLines, effectiveSectionVoice, khmerRatio, parseLyrics, type ParsedSection } from "./lyrics";
import { NATURAL_NEGATIVE, NATURAL_POSITIVE, SECTION_DELIVERY, VOICE_DIRECTIONS, presetById } from "./presets";

export interface PlanSection {
  section_name: string;
  positive_local_styles: string[];
  negative_local_styles: string[];
  duration_ms: number;
  lines: string[];
}
export interface CompositionPlan {
  positive_global_styles: string[];
  negative_global_styles: string[];
  sections: PlanSection[];
}

export interface GenerationRequest {
  input: SongInput;
  sections: ParsedSection[];
  /** Provider-neutral description of what to ask for. Adapters translate it to their API. */
  kind: "plan" | "prompt";
  plan?: CompositionPlan;
  prompt?: string;
  musicLengthMs: number;
  forceInstrumental: boolean;
  warnings: string[];
}

const MIN_SECTION_MS = 3000;
const MAX_SECTION_MS = 120_000;
const MAX_TOTAL_MS = 600_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function splitStyles(text: string, maxLen = 150, maxItems = 40): string[] {
  return text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.length > maxLen ? s.slice(0, maxLen).trim() : s))
    .slice(0, maxItems);
}

export function voiceDirectionText(input: SongInput): string {
  if (input.voiceDirection === "custom") return input.voiceCustom;
  return VOICE_DIRECTIONS.find((v) => v.id === input.voiceDirection)?.style ?? input.voiceCustom;
}

function sectionDurationsMs(sections: ParsedSection[], targetSeconds: number | null): number[] {
  const base = sections.map((s) => (s.lines.length ? clamp(s.lines.length * 4500 + 3500, 9000, MAX_SECTION_MS) : s.kind === "outro" || s.kind === "intro" ? 10_000 : 8_000));
  if (targetSeconds) {
    const k = (targetSeconds * 1000) / base.reduce((a, b) => a + b, 0);
    return base.map((d) => clamp(Math.round(d * k), MIN_SECTION_MS, MAX_SECTION_MS));
  }
  const total = base.reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL_MS) return base.map((d) => clamp(Math.floor((d * MAX_TOTAL_MS) / total), MIN_SECTION_MS, MAX_SECTION_MS));
  return base;
}

function hintFor(lines: string[], hints: Record<string, string>): string[] {
  const out: string[] = [];
  for (const l of lines) if (hints[l] && !out.includes(hints[l])) out.push(hints[l]);
  return out;
}

/** Build a provider-neutral request from the user's input. Lyrics are passed through verbatim. */
export function buildGeneration(input: SongInput, caps: Capabilities): GenerationRequest {
  const sections = parseLyrics(input.lyrics);
  const warnings: string[] = [];
  const preset = presetById(input.presetId);
  const styleText = input.stylePrompt || preset?.style || "";
  const instrumental = input.outputMode === "instrumental";
  const vocalWords = !instrumental;
  const hasKhmer = khmerRatio(input.lyrics) > 0.3;

  const globalPos = splitStyles(styleText);
  if (vocalWords) {
    const vd = voiceDirectionText(input);
    if (vd) globalPos.push(...splitStyles(vd));
    if (hasKhmer) globalPos.push("sung in the Khmer language");
    if (input.naturalSinging) globalPos.push(...NATURAL_POSITIVE);
  }
  const globalNeg = vocalWords && input.naturalSinging ? [...NATURAL_NEGATIVE] : [];
  if (instrumental) globalNeg.push("vocals", "singing", "choir");

  const durations = sectionDurationsMs(sections, input.targetSeconds);
  const totalMs = clamp(durations.reduce((a, b) => a + b, 0) || (input.targetSeconds ?? 60) * 1000, MIN_SECTION_MS, MAX_TOTAL_MS);

  const base: GenerationRequest = { input, sections, kind: "plan", musicLengthMs: totalMs, forceInstrumental: false, warnings };

  if (instrumental || sections.length === 0) {
    const names = sections.map((s) => s.label).join(", ");
    base.kind = "prompt";
    base.forceInstrumental = true;
    base.prompt = [styleText, "instrumental, no vocals", names ? `song structure: ${names}` : ""].filter(Boolean).join(". ").slice(0, 4000);
    base.musicLengthMs = clamp(input.targetSeconds ? input.targetSeconds * 1000 : totalMs, MIN_SECTION_MS, MAX_TOTAL_MS);
    return base;
  }

  const plan: CompositionPlan = { positive_global_styles: globalPos, negative_global_styles: globalNeg, sections: [] };
  sections.forEach((s, i) => {
    const pos = [...(SECTION_DELIVERY[s.kind] ?? [])];
    const neg: string[] = [];
    if (s.lines.length) {
      const v = effectiveSectionVoice(sections, i, input.vocalMode, input.sectionVoices);
      if (input.vocalMode === "duet") {
        if (v === "male") {
          pos.push("male vocal only in this section");
          neg.push("female vocals");
        } else if (v === "female") {
          pos.push("female vocal only in this section");
          neg.push("male vocals");
        } else pos.push("male and female voices singing together in harmony");
      }
      if (input.sendHints) {
        const h = hintFor(s.lines, input.hints);
        if (h.length) pos.push(`pronunciation guide: ${h.join("; ")}`.slice(0, 190));
      }
    }
    plan.sections.push({
      section_name: s.label.slice(0, 100),
      positive_local_styles: pos.map((p) => p.slice(0, 190)),
      negative_local_styles: neg,
      duration_ms: durations[i],
      lines: s.lines,
    });
  });
  base.plan = plan;
  base.musicLengthMs = clamp(durations.reduce((a, b) => a + b, 0), MIN_SECTION_MS, MAX_TOTAL_MS);
  return base;
}

const mapSupport = (s: Support, on: boolean): ControlReport["status"] => (!on ? "local" : s === "native" ? "applied" : s === "prompt" ? "guidance" : "unavailable");

/** Honest per-control status: what actually reaches the provider and how. */
export function buildControlReport(input: SongInput, caps: Capabilities): ControlReport[] {
  const sections = parseLyrics(input.lyrics);
  const lines = allLyricLines(sections);
  const r: ControlReport[] = [];
  r.push({ id: "title", status: "local", detail: "Kept in your library only; the provider has no title field." });
  if (input.outputMode !== "instrumental")
    r.push({ id: "lyrics", status: "applied", detail: `${lines.length} lines sent verbatim; your editor text is never rewritten.` });
  r.push({ id: "structure", status: "applied", detail: `${sections.length} sections with estimated durations.` });
  r.push({ id: "style", status: "guidance", detail: "Free-text style, instruments, mood and tempo are interpreted by the model and may not be followed exactly." });
  if (input.outputMode === "instrumental") r.push({ id: "instrumental", status: caps.instrumental ? "applied" : "unavailable", detail: "Instrumental flag sent to provider." });
  if (input.outputMode !== "instrumental") {
    r.push({ id: "voiceDirection", status: mapSupport(caps.voiceDirection, true), detail: "Voice character is described in text; it is not a selectable voice ID." });
    if (input.vocalMode === "duet")
      r.push({ id: "sectionVoice", status: mapSupport(caps.sectionVoice, true), detail: "Per-section male / female / both assignments are written into each section's style text." });
    const hasHints = Object.keys(input.hints).length > 0;
    r.push({
      id: "hints",
      status: !hasHints ? "local" : !input.sendHints ? "local" : mapSupport(caps.pronunciationHints, true),
      detail: !hasHints ? "No pronunciation hints entered." : !input.sendHints ? "Hints stored but not sent (toggle is off)." : "Hints appended to section style text; the model may ignore them.",
    });
    r.push({ id: "natural", status: input.naturalSinging ? "guidance" : "local", detail: "Breaths, vibrato, intimacy/build and low-reverb direction are text guidance." });
    r.push({ id: "customVoice", status: caps.customVoices ? "applied" : "unavailable", detail: "Custom / cloned voices are not supported by this adapter." });
  }
  r.push({ id: "length", status: input.targetSeconds ? "guidance" : "local", detail: "Section durations are requested; the provider decides the final length." });
  if (input.outputMode === "vocals") r.push({ id: "vocalsOnly", status: caps.vocalsOnly ? "applied" : "unavailable", detail: caps.vocalsOnlyReason });
  return r;
}
