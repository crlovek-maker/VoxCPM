import type { Capabilities, JobResult } from "../types";
import type { GenerationRequest } from "../generation";

export interface ProviderOutput {
  audio: Buffer;
  format: string; // file extension, e.g. "mp3"
  mime: string;
  stems?: { name: string; data: Buffer; format: string; mime: string }[];
}

export interface GenerateContext {
  signal: AbortSignal;
  /** progress is 0..1 or null when unknown */
  onStage: (stage: string, progress: number | null) => void;
}

/** Implement this to plug in another music generation backend. */
export interface MusicProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: "live" | "demo";
  capabilities(): Capabilities;
  generate(req: GenerationRequest, ctx: GenerateContext): Promise<ProviderOutput>;
}

export type { JobResult };
