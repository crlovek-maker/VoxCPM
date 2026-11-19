import type { PresetId, VocalMode } from "./types";

export interface Preset {
  id: Exclude<PresetId, "custom">;
  /** English style text sent to the provider (editable by the user). */
  style: string;
  bpm: [number, number];
}

// Style prompts deliberately avoid artist names: music APIs commonly reject them.
export const PRESETS: Preset[] = [
  {
    id: "khmer-sad-ballad",
    bpm: [58, 72],
    style:
      "Khmer sad ballad, slow tempo around 64 BPM, minor key, soft piano, tro khmer fiddle and khim dulcimer, warm string pad, gentle brushed percussion, melancholic and tender",
  },
  {
    id: "khmer-kentrim",
    bpm: [100, 120],
    style:
      "Khmer kantrum (kentrim) folk-dance groove, cheerful, around 112 BPM, skor drums and hand percussion, khim, bass guitar, bright call-and-response feel, festive village-party energy",
  },
  {
    id: "khmer-60s-ballad",
    bpm: [66, 80],
    style:
      "1960s-inspired Cambodian golden-age ballad, vintage warm tape sound, around 72 BPM, clean electric guitar with tremolo, Hammond organ, upright bass, brushed drums, light strings, nostalgic romantic crooning",
  },
  {
    id: "pop-rock",
    bpm: [110, 132],
    style:
      "modern pop rock, around 120 BPM, driving drums, crunchy rhythm guitars, bright lead guitar hook, punchy bass, anthemic singalong chorus",
  },
  {
    id: "rap-trap",
    bpm: [130, 150],
    style:
      "melodic rap and trap, around 140 BPM, heavy 808 bass, crisp rolling hi-hats, dark atmospheric synth pads, rhythmic rapped verses with a sung hook",
  },
  {
    id: "edm",
    bpm: [120, 130],
    style:
      "uplifting EDM, around 126 BPM, four-on-the-floor kick, sidechained synth pads, plucky arpeggios, big build-up and euphoric drop, vocal-forward mix",
  },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id);

export interface VoiceDirection {
  id: string;
  for: VocalMode;
  /** English descriptor sent as prompt guidance. */
  style: string;
}

export const VOICE_DIRECTIONS: VoiceDirection[] = [
  { id: "male-baritone", for: "male", style: "warm male baritone lead vocal, close-mic, soft attack, intimate" },
  { id: "male-tenor", for: "male", style: "smooth male tenor lead vocal, clear and sweet, gentle falsetto touches" },
  { id: "female-alto", for: "female", style: "gentle female alto lead vocal, warm, soft, close-mic" },
  { id: "female-soprano", for: "female", style: "bright female soprano lead vocal, airy, light and expressive" },
  { id: "duet-breathy", for: "duet", style: "breathy male and female duet, soft close harmonies, intimate" },
  { id: "duet-warm", for: "duet", style: "warm male baritone and gentle female alto duet, trading lines and joining in harmony" },
];

export const defaultVoiceFor = (mode: VocalMode) => VOICE_DIRECTIONS.find((v) => v.for === mode)!.id;

/** Always-on "natural singing" guidance (all of it is prompt-level; no provider exposes these as knobs). */
export const NATURAL_POSITIVE = [
  "clear Khmer consonants and vowels",
  "natural breaths between phrases",
  "smooth note transitions",
  "restrained vibrato",
  "phrasing follows the meaning of the lyrics",
  "lead vocal clear and upfront above the instruments",
  "low reverb, dry intimate vocal",
];
export const NATURAL_NEGATIVE = [
  "heavy reverb",
  "vocals buried under instruments",
  "excessive vibrato",
  "robotic or autotuned vocals",
];

export const SECTION_DELIVERY: Record<string, string[]> = {
  intro: ["instrumental intro, sets the mood"],
  verse: ["intimate, close and soft delivery", "restrained dynamics"],
  chorus: ["emotional build", "fuller, more open delivery", "memorable melody"],
  bridge: ["stripped back then rising", "emotional peak"],
  outro: ["gentle resolve, slow fade"],
  other: [],
};
