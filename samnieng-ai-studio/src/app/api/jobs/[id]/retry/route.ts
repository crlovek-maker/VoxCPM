import { NextResponse } from "next/server";
import { retryJob } from "@/lib/runner";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { job, duplicate } = await retryJob(id);
    return NextResponse.json({ job, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
