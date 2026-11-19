import { NextResponse } from "next/server";
import { getJobFresh, removeJob } from "@/lib/runner";
import { isValidId } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const job = await getJobFresh(id);
  if (!job) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Song not found." } }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  if (!isValidId(id)) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Bad id." } }, { status: 400 });
  await removeJob(id);
  return NextResponse.json({ ok: true });
}
