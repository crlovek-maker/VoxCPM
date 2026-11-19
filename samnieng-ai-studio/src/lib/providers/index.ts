import type { CapabilitiesResponse } from "../types";
import { DemoProvider } from "./demo";
import { ElevenLabsProvider } from "./elevenlabs";
import type { MusicProvider } from "./types";

export interface Resolved {
  provider: MusicProvider;
  live: boolean;
  configIssue: CapabilitiesResponse["configIssue"];
  /** Set when live credentials are required but absent: generation must be refused. */
  blocked: boolean;
}

/** Decide which adapter to use from environment variables. Add new adapters here. */
export function resolveProvider(env: Record<string, string | undefined> = process.env): Resolved {
  const want = (env.MUSIC_PROVIDER ?? "auto").trim().toLowerCase();
  const hasKey = !!env.ELEVENLABS_API_KEY?.trim();
  if (want === "demo") return { provider: new DemoProvider(), live: false, configIssue: "forced_demo", blocked: false };
  if (want === "elevenlabs" && !hasKey)
    return { provider: new ElevenLabsProvider(env), live: true, configIssue: "missing_credentials_required", blocked: true };
  if (hasKey) return { provider: new ElevenLabsProvider(env), live: true, configIssue: null, blocked: false };
  return { provider: new DemoProvider(), live: false, configIssue: "no_credentials", blocked: false };
}
