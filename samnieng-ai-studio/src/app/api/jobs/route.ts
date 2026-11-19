import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { errorResponse } from "@/lib/http";
import { enqueue, listJobsFresh } from "@/lib/runner";
import { coerceInput } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listJobsFresh() });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse(new AppError("INVALID_INPUT", "Request body must be JSON.", false, 400));
  }
  try {
    const { job, duplicate } = await enqueue(coerceInput(raw));
    return NextResponse.json({ job, duplicate }, { status: duplicate ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
