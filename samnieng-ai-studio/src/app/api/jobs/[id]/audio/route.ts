import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getJobFresh } from "@/lib/runner";
import { audioPath } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 80) || "song";

/** Streams the stored audio (with Range support for seeking). `?stem=<name>` selects a provider stem; `?download=1` forces a download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const job = await getJobFresh(id);
  if (!job?.result) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Audio is not available." } }, { status: 404 });

  const stemName = url.searchParams.get("stem");
  const item = stemName ? job.result.stems?.find((s) => s.name === stemName) : job.result.audio;
  if (!item) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Stem not available." } }, { status: 404 });
  const file = "file" in item ? item.file : "";
  const p = audioPath(id, file);
  if (!p) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Bad file." } }, { status: 400 });
  let size: number;
  try {
    size = (await fs.stat(p)).size;
  } catch {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Audio file is missing on disk." } }, { status: 404 });
  }

  const headers: Record<string, string> = { "content-type": item.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  if (url.searchParams.get("download")) {
    const base = safeName(job.input.title) + (stemName ? `-${stemName}` : "");
    headers["content-disposition"] = `attachment; filename="song.${item.format}"; filename*=UTF-8''${encodeURIComponent(`${base}.${item.format}`)}`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["content-length"] = String(end - start + 1);
  const stream = Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
}
