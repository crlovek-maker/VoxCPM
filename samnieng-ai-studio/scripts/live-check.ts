// Real-provider smoke test: generates the Khmer sample with your key and saves the audio for you to LISTEN to.
// Usage: ELEVENLABS_API_KEY=... npm run live-check      (costs provider credits)
import { writeFileSync, mkdirSync } from "node:fs";
import sample from "../samples/khmer-sample.json";
import { buildGeneration } from "../src/lib/generation";
import { ElevenLabsProvider } from "../src/lib/providers/elevenlabs";
import { coerceInput } from "../src/lib/validate";

const p = new ElevenLabsProvider();
const req = buildGeneration(coerceInput({ ...sample, targetSeconds: 60 }), p.capabilities());
console.log("Sending plan with", req.plan?.sections.length, "sections …");
const t0 = Date.now();
const out = await p.generate(req, { signal: new AbortController().signal, onStage: (s) => console.log(" stage:", s) });
mkdirSync("test-output", { recursive: true });
const file = `test-output/live-khmer-sample.${out.format}`;
writeFileSync(file, out.audio);
console.log(`Saved ${file} (${out.audio.length} bytes, ${Math.round((Date.now() - t0) / 1000)}s). Listen for: Khmer pronunciation, lyric fidelity, male/female per section.`);
