export type Lang = "km" | "en";
export type VocalMode = "male" | "female" | "duet";
export type OutputMode = "full" | "instrumental" | "vocals";
export type SectionVoice = "male" | "female" | "both";
export type PresetId =
  | "khmer-sad-ballad"
  | "khmer-kentrim"
  | "khmer-60s-ballad"
  | "pop-rock"
  | "rap-trap"
  | "edm"
  | "custom";

/** Everything the user controls. `lyrics` is exactly what is visible in the editor. */
export interface SongInput {
  title: string;
  lyrics: string;
  presetId: PresetId;
  stylePrompt: string;
  vocalMode: VocalMode;
  /** id from VOICE_DIRECTIONS, or "custom" */
  voiceDirection: string;
  voiceCustom: string;
  /** Section index (as string) -> voice. Only used in duet mode. */
  sectionVoices: Record<string, SectionVoice>;
  outputMode: OutputMode;
  /** Target length in seconds, or null for "let the provider decide". */
  targetSeconds: number | null;
  /** Pronunciation hints, stored apart from lyrics, keyed by the exact lyric line text. */
  hints: Record<string, string>;
  sendHints: boolean;
  naturalSinging: boolean;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export type ControlStatus = "applied" | "guidance" | "unavailable" | "local";
export interface ControlReport {
  id: string;
  status: ControlStatus;
  detail: string;
}

export interface JobResult {
  audio: { file: string; format: string; mime: string; bytes: number };
  stems?: { name: string; file: string; format: string; mime: string; bytes: number }[];
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  stage: string;
  /** 0..1, or null when the provider does not report progress */
  progress: number | null;
  provider: { id: string; label: string; mode: "live" | "demo"; model?: string };
  input: SongInput;
  inputHash: string;
  controls: ControlReport[];
  warnings: string[];
  result?: JobResult;
  error?: JobError;
  retryOf?: string;
}

export type Support = "native" | "prompt" | "none";

export interface Capabilities {
  providerId: string;
  label: string;
  mode: "live" | "demo";
  model?: string;
  sungVocals: boolean;
  instrumental: boolean;
  vocalsOnly: boolean;
  vocalsOnlyReason: string;
  stems: boolean;
  sectionVoice: Support;
  voiceDirection: Support;
  pronunciationHints: Support;
  tempoControl: Support;
  customVoices: boolean;
  minSeconds: number;
  maxSeconds: number;
  outputFormats: string[];
  khmerVerified: boolean;
  notes: string[];
}

export interface CapabilitiesResponse {
  capabilities: Capabilities;
  /** True when a real provider is configured; false means demo mode. */
  live: boolean;
  /** Why we are in demo mode / what is wrong with configuration. */
  configIssue: null | "no_credentials" | "forced_demo" | "missing_credentials_required";
}

export interface FieldError {
  field: string;
  key: string;
  params?: Record<string, string | number>;
  message: string;
}
