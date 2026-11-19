import { promises as fs } from "node:fs";
import path from "node:path";
import type { Job } from "./types";

const root = () => path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR || ".data");
const jobsDir = () => path.join(root(), "jobs");
const audioDir = () => path.join(root(), "audio");

export const isValidId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

async function ensure() {
  await fs.mkdir(jobsDir(), { recursive: true });
  await fs.mkdir(audioDir(), { recursive: true });
}

export async function saveJob(job: Job): Promise<void> {
  await ensure();
  const file = path.join(jobsDir(), `${job.id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(job, null, 2));
  await fs.rename(tmp, file);
}

export async function getJob(id: string): Promise<Job | null> {
  if (!isValidId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(jobsDir(), `${id}.json`), "utf8")) as Job;
  } catch {
    return null;
  }
}

export async function listJobs(limit = 100): Promise<Job[]> {
  await ensure();
  const names = (await fs.readdir(jobsDir())).filter((n) => n.endsWith(".json"));
  const jobs = (await Promise.all(names.map((n) => getJob(n.slice(0, -5))))).filter((j): j is Job => !!j);
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export async function deleteJob(id: string): Promise<void> {
  if (!isValidId(id)) return;
  await fs.rm(path.join(jobsDir(), `${id}.json`), { force: true });
  await fs.rm(path.join(audioDir(), id), { recursive: true, force: true });
}

export async function writeAudio(id: string, name: string, ext: string, data: Buffer): Promise<string> {
  await ensure();
  const dir = path.join(audioDir(), id);
  await fs.mkdir(dir, { recursive: true });
  const file = `${name.replace(/[^a-z0-9_-]/gi, "")}.${ext.replace(/[^a-z0-9]/gi, "")}`;
  await fs.writeFile(path.join(dir, file), data);
  return file;
}

/** Resolve a stored audio file path; rejects anything that is not a plain file name inside the job's folder. */
export function audioPath(id: string, file: string): string | null {
  if (!isValidId(id) || !/^[a-z0-9_-]+\.[a-z0-9]+$/i.test(file)) return null;
  return path.join(audioDir(), id, file);
}
