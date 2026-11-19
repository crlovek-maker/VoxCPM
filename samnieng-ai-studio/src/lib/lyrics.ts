import type { SectionVoice, VocalMode } from "./types";

export type SectionKind = "intro" | "verse" | "chorus" | "bridge" | "outro" | "other";

export interface ParsedSection {
  index: number;
  /** Tag as typed by the user, e.g. "Verse 2" */
  tag: string;
  kind: SectionKind;
  /** Display label, numbered when a kind repeats without a number */
  label: string;
  lines: string[];
  /** True when the section has no explicit tag (text before the first tag). */
  implicit: boolean;
}

export const SECTION_TAGS = ["Intro", "Verse", "Chorus", "Bridge", "Outro"] as const;

const TAG_RE = /^\s*\[([^\]\n]{1,40})\]\s*$/;

export function kindOf(tag: string): SectionKind {
  const t = tag.trim().toLowerCase();
  if (t.startsWith("intro")) return "intro";
  if (t.startsWith("verse")) return "verse";
  if (t.startsWith("pre-chorus") || t.startsWith("prechorus") || t.startsWith("chorus") || t.startsWith("hook")) return "chorus";
  if (t.startsWith("bridge") || t.startsWith("break")) return "bridge";
  if (t.startsWith("outro") || t.startsWith("end")) return "outro";
  return "other";
}

/** Split lyrics into sections. Lyric lines are never modified. */
export function parseLyrics(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let cur: ParsedSection | null = null;
  const push = (tag: string, implicit: boolean) => {
    cur = { index: sections.length, tag, kind: implicit ? "verse" : kindOf(tag), label: tag, lines: [], implicit };
    sections.push(cur);
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = TAG_RE.exec(raw);
    if (m) {
      push(m[1].trim(), false);
      continue;
    }
    if (raw.trim() === "") continue;
    if (!cur) push("Verse", true);
    cur!.lines.push(raw.trim());
  }
  // number repeated untitled kinds: "Verse", "Verse" -> "Verse 1", "Verse 2"
  const counts = new Map<string, number>();
  for (const s of sections) counts.set(s.tag.toLowerCase(), (counts.get(s.tag.toLowerCase()) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const s of sections) {
    const key = s.tag.toLowerCase();
    if ((counts.get(key) ?? 0) > 1 && !/\d/.test(s.tag)) {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      s.label = `${s.tag} ${n}`;
    }
  }
  return sections;
}

export function allLyricLines(sections: ParsedSection[]): string[] {
  return sections.flatMap((s) => s.lines);
}

/** Default duet assignment: verses alternate male/female, everything else is shared. */
export function defaultSectionVoice(sections: ParsedSection[], index: number): SectionVoice {
  const s = sections[index];
  if (!s) return "both";
  if (s.kind === "verse") {
    const verseNo = sections.slice(0, index).filter((x) => x.kind === "verse").length;
    return verseNo % 2 === 0 ? "male" : "female";
  }
  return "both";
}

export function effectiveSectionVoice(
  sections: ParsedSection[],
  index: number,
  vocalMode: VocalMode,
  overrides: Record<string, SectionVoice>,
): SectionVoice {
  if (vocalMode === "male") return "male";
  if (vocalMode === "female") return "female";
  return overrides[String(index)] ?? defaultSectionVoice(sections, index);
}

/** Share of letters that are Khmer script (U+1780–U+17FF, U+19E0–U+19FF). */
export function khmerRatio(text: string): number {
  let khmer = 0;
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x1780 && c <= 0x17ff) || (c >= 0x19e0 && c <= 0x19ff)) {
      khmer++;
      letters++;
    } else if (/\p{L}/u.test(ch)) letters++;
  }
  return letters === 0 ? 0 : khmer / letters;
}

/** Insert a [Tag] on its own line at the caret, keeping surrounding text untouched. */
export function insertTagAt(text: string, tag: string, caret: number): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const ins = `${lead}[${tag}]\n`;
  return { text: before + ins + after, caret: before.length + ins.length };
}
