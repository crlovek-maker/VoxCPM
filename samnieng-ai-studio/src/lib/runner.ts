import { createHash, randomUUID } from "node:crypto";
import { AppError, toJobError } from "./errors";
import { buildControlReport, buildGeneration } from "./generation";
import { resolveProvider } from "./providers";
import { deleteJob, getJob, listJobs, saveJob, writeAudio } from "./store";
import type { Job, SongInput } from "./types";
import { validateInput } from "./validate";

interface RunnerState {
  active: Map<string, AbortController>;
  removed: Set<string>;
}
const g = globalThis as unknown as { __samnieng?: RunnerState };
const state: RunnerState = (g.__samnieng ??= { active: new Map(), removed: new Set() });

const maxConcurrent = () => Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS) || 2);
const hashInput = (input: SongInput, providerId: string) => createHash("sha256").update(JSON.stringify([providerId, input])).digest("hex").slice(0, 32);
const inflight = (j: Job) => j.status === "queued" || j.status === "running";

async function update(job: Job, patch: Partial<Job>) {
  if (state.removed.has(job.id)) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await saveJob(job);
}

/** A job that claims to be running but has no live runner in this process was orphaned by a restart. */
async function reconcile(job: Job): Promise<Job> {
  if (inflight(job) && !state.active.has(job.id)) {
    await update(job, { status: "failed", stage: "interrupted", progress: null, error: { code: "INTERRUPTED", message: "The server restarted while this song was being generated. Retry to start again.", retryable: true } });
  }
  return job;
}

export async function getJobFresh(id: string): Promise<Job | null> {
  const j = await getJob(id);
  return j ? reconcile(j) : null;
}
export async function listJobsFresh(): Promise<Job[]> {
  return Promise.all((await listJobs()).map(reconcile));
}

export async function enqueue(input: SongInput, retryOf?: string): Promise<{ job: Job; duplicate: boolean }> {
  const { provider, blocked } = resolveProvider();
  if (blocked) throw new AppError("MISSING_CREDENTIALS", "MUSIC_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set on the server.", false, 503);
  const caps = provider.capabilities();
  const errors = validateInput(input, caps);
  if (errors.length) {
    const e = new AppError(errors.some((x) => x.key.startsWith("v.output")) ? "UNSUPPORTED_CAPABILITY" : "INVALID_INPUT", errors.map((x) => x.message).join(" "), false, 400);
    (e as AppError & { fields?: unknown }).fields = errors;
    throw e;
  }

  const inputHash = hashInput(input, provider.id);
  const jobs = await listJobsFresh();
  const dup = jobs.find((j) => j.inputHash === inputHash && inflight(j));
  if (dup) return { job: dup, duplicate: true };
  if (jobs.filter(inflight).length >= maxConcurrent())
    throw new AppError("TOO_MANY_JOBS", `Too many songs are generating at once (limit ${maxConcurrent()}). Wait for one to finish.`, true, 429);

  const req = buildGeneration(input, caps);
  const now = new Date().toISOString();
  const job: Job = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "queued",
    stage: "queued",
    progress: 0,
    provider: { id: provider.id, label: provider.label, mode: provider.mode, model: caps.model },
    input,
    inputHash,
    controls: buildControlReport(input, caps),
    warnings: req.warnings,
    retryOf,
  };
  await saveJob(job);
  const ctrl = new AbortController();
  state.active.set(job.id, ctrl);
  void run(job, req, ctrl);
  return { job, duplicate: false };
}

async function run(job: Job, req: ReturnType<typeof buildGeneration>, ctrl: AbortController) {
  const { provider } = resolveProvider();
  try {
    await update(job, { status: "running", stage: "submitting" });
    let chain = Promise.resolve();
    const out = await provider.generate(req, {
      signal: ctrl.signal,
      onStage: (stage, progress) => {
        chain = chain.then(() => update(job, { stage, progress })).catch(() => undefined);
      },
    });
    await chain;
    const file = await writeAudio(job.id, "song", out.format, out.audio);
    const stems = out.stems ? await Promise.all(out.stems.map(async (s) => ({ name: s.name, file: await writeAudio(job.id, `stem-${s.name}`, s.format, s.data), format: s.format, mime: s.mime, bytes: s.data.length }))) : undefined;
    await update(job, {
      status: "succeeded",
      stage: "done",
      progress: 1,
      result: { audio: { file, format: out.format, mime: out.mime, bytes: out.audio.length }, ...(stems?.length ? { stems } : {}) },
    });
  } catch (e) {
    const err = ctrl.signal.aborted && !(e instanceof AppError) ? new AppError("CANCELLED", "Generation was cancelled.", true) : e;
    await update(job, { status: "failed", stage: "failed", progress: null, error: toJobError(err) }).catch(() => undefined);
  } finally {
    state.active.delete(job.id);
  }
}

export async function retryJob(id: string) {
  const old = await getJobFresh(id);
  if (!old) throw new AppError("INVALID_INPUT", "Song not found.", false, 404);
  if (old.status !== "failed") throw new AppError("INVALID_INPUT", "Only failed songs can be retried.", false, 409);
  return enqueue(old.input, old.id);
}

export async function removeJob(id: string) {
  const ctrl = state.active.get(id);
  if (ctrl) {
    state.removed.add(id);
    ctrl.abort(new Error("cancelled"));
    await new Promise((r) => setTimeout(r, 100));
  }
  await deleteJob(id);
}
