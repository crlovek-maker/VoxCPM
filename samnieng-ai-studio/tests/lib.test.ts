import { describe, expect, it } from "vitest";
import { insertTagAt, khmerRatio, parseLyrics, effectiveSectionVoice } from "@/lib/lyrics";
import { coerceInput, validateInput } from "@/lib/validate";
import { buildControlReport, buildGeneration } from "@/lib/generation";
import { DemoProvider } from "@/lib/providers/demo";
import { ElevenLabsProvider } from "@/lib/providers/elevenlabs";
import { resolveProvider } from "@/lib/providers";
import sample from "../samples/khmer-sample.json";

const input = () => coerceInput(sample);
const eleven = new ElevenLabsProvider({ ELEVENLABS_API_KEY: "k" }).capabilities();

describe("lyrics", () => {
  it("parses sections and keeps lines verbatim", () => {
    const s = parseLyrics(sample.lyrics);
    expect(s.map((x) => x.label)).toEqual(["Intro", "Verse 1", "Verse 2", "Chorus", "Bridge", "Outro"]);
    expect(s[1].lines[0]).toBe("យប់នេះខែភ្លឺ លើទន្លេមេគង្គា");
    expect(s[0].lines).toEqual([]);
  });
  it("numbers repeated untitled tags and treats leading text as an implicit verse", () => {
    const s = parseLyrics("hello\n[Chorus]\na\n[Chorus]\nb");
    expect(s.map((x) => x.label)).toEqual(["Verse", "Chorus 1", "Chorus 2"]);
    expect(s[0].implicit).toBe(true);
  });
  it("detects Khmer script", () => {
    expect(khmerRatio(sample.lyrics)).toBeGreaterThan(0.9);
    expect(khmerRatio("hello world")).toBe(0);
  });
  it("inserts tags without touching text", () => {
    expect(insertTagAt("abc", "Verse", 3)).toEqual({ text: "abc\n\n[Verse]\n", caret: 13 });
  });
  it("duet defaults alternate verses, overrides win", () => {
    const s = parseLyrics(sample.lyrics);
    expect(effectiveSectionVoice(s, 1, "duet", {})).toBe("male");
    expect(effectiveSectionVoice(s, 2, "duet", {})).toBe("female");
    expect(effectiveSectionVoice(s, 3, "duet", {})).toBe("both");
    expect(effectiveSectionVoice(s, 1, "duet", { "1": "female" })).toBe("female");
    expect(effectiveSectionVoice(s, 1, "male", { "1": "female" })).toBe("male");
  });
});

describe("validation", () => {
  const caps = { minSeconds: 3, maxSeconds: 600, vocalsOnly: false, instrumental: true };
  it("accepts the sample", () => expect(validateInput(input(), caps)).toEqual([]));
  it("flags missing title / lyrics / style", () => {
    const keys = validateInput(coerceInput({ lyrics: "", stylePrompt: "", presetId: "custom" }), caps).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["v.title.required", "v.lyrics.required", "v.style.required"]));
  });
  it("instrumental does not need lyrics; vocals-only is refused when unsupported", () => {
    const i = { ...input(), lyrics: "", outputMode: "instrumental" as const };
    expect(validateInput(i, caps)).toEqual([]);
    expect(validateInput({ ...input(), outputMode: "vocals" }, caps).map((e) => e.key)).toContain("v.output.vocalsUnavailable");
  });
  it("rejects over-long lines and bad lengths", () => {
    const i = { ...input(), lyrics: "[Verse]\n" + "ក".repeat(201), targetSeconds: 9999 };
    const keys = validateInput(i, caps).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(["v.lyrics.lineLong", "v.length.range"]));
  });
  it("coerces junk safely", () => {
    const i = coerceInput({ vocalMode: "x", outputMode: 5, sectionVoices: { a: "male", "1": "zzz", "2": "female" }, hints: { a: " ", b: " h " } });
    expect(i.vocalMode).toBe("female");
    expect(i.outputMode).toBe("full");
    expect(i.sectionVoices).toEqual({ "2": "female" });
    expect(i.hints).toEqual({ b: "h" });
  });
});

describe("generation request", () => {
  it("passes lyric lines verbatim and keeps hints out of lyrics", () => {
    const i = input();
    const r = buildGeneration(i, eleven);
    expect(r.kind).toBe("plan");
    const sent = r.plan!.sections.flatMap((s) => s.lines);
    expect(sent).toEqual(parseLyrics(i.lyrics).flatMap((s) => s.lines));
    expect(sent.join("\n")).not.toMatch(/dop-bram/);
    expect(JSON.stringify(r.plan!.sections.map((s) => s.positive_local_styles))).toMatch(/dop-bram/);
  });
  it("does not send hints when the toggle is off", () => {
    const r = buildGeneration({ ...input(), sendHints: false }, eleven);
    expect(JSON.stringify(r.plan)).not.toMatch(/dop-bram/);
  });
  it("maps duet assignments to section styles", () => {
    const r = buildGeneration(input(), eleven);
    const by = Object.fromEntries(r.plan!.sections.map((s) => [s.section_name, s]));
    expect(by["Verse 1"].positive_local_styles.join()).toMatch(/male vocal only/);
    expect(by["Verse 1"].negative_local_styles).toContain("female vocals");
    expect(by["Verse 2"].positive_local_styles.join()).toMatch(/female vocal only/);
    expect(by["Chorus"].positive_local_styles.join()).toMatch(/together in harmony/);
  });
  it("gives verses intimate and choruses building direction, with low-reverb guidance", () => {
    const r = buildGeneration(input(), eleven);
    const by = Object.fromEntries(r.plan!.sections.map((s) => [s.section_name, s]));
    expect(by["Verse 1"].positive_local_styles.join()).toMatch(/intimate/);
    expect(by["Chorus"].positive_local_styles.join()).toMatch(/build/);
    expect(r.plan!.positive_global_styles.join()).toMatch(/low reverb/);
    expect(r.plan!.negative_global_styles).toContain("heavy reverb");
  });
  it("respects API limits on durations", () => {
    const r = buildGeneration({ ...input(), targetSeconds: 600 }, eleven);
    for (const s of r.plan!.sections) expect(s.duration_ms).toBeGreaterThanOrEqual(3000), expect(s.duration_ms).toBeLessThanOrEqual(120000);
    expect(r.musicLengthMs).toBeLessThanOrEqual(600000);
  });
  it("instrumental uses prompt + forceInstrumental and no lyrics", () => {
    const r = buildGeneration({ ...input(), outputMode: "instrumental" }, eleven);
    expect(r.kind).toBe("prompt");
    expect(r.forceInstrumental).toBe(true);
    expect(r.prompt).not.toMatch(/យប់នេះ/);
  });
  it("control report is honest about guidance vs unavailable", () => {
    const rep = Object.fromEntries(buildControlReport(input(), eleven).map((c) => [c.id, c.status]));
    expect(rep).toMatchObject({ title: "local", lyrics: "applied", sectionVoice: "guidance", hints: "guidance", customVoice: "unavailable", voiceDirection: "guidance" });
    const demo = Object.fromEntries(buildControlReport(input(), new DemoProvider().capabilities()).map((c) => [c.id, c.status]));
    expect(demo).toMatchObject({ sectionVoice: "unavailable", hints: "unavailable" });
  });
});

describe("provider resolution", () => {
  it("demo without key, live with key, blocked when forced without key", () => {
    expect(resolveProvider({})).toMatchObject({ live: false, configIssue: "no_credentials", blocked: false });
    expect(resolveProvider({ ELEVENLABS_API_KEY: "x" })).toMatchObject({ live: true, blocked: false });
    expect(resolveProvider({ MUSIC_PROVIDER: "elevenlabs" })).toMatchObject({ blocked: true, configIssue: "missing_credentials_required" });
    expect(resolveProvider({ MUSIC_PROVIDER: "demo", ELEVENLABS_API_KEY: "x" })).toMatchObject({ live: false, configIssue: "forced_demo" });
  });
  it("never offers vocals-only or stems for the adapters shipped", () => {
    expect(eleven.vocalsOnly).toBe(false);
    expect(eleven.stems).toBe(false);
    expect(eleven.khmerVerified).toBe(false);
  });
});
