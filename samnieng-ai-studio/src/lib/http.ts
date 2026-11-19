import { NextResponse } from "next/server";
import { AppError } from "./errors";

export function errorResponse(e: unknown) {
  if (e instanceof AppError) {
    const fields = (e as AppError & { fields?: unknown }).fields;
    return NextResponse.json({ error: { code: e.code, message: e.message, retryable: e.retryable, fields } }, { status: e.status });
  }
  return NextResponse.json({ error: { code: "INTERNAL", message: e instanceof Error ? e.message : "Unexpected error", retryable: true } }, { status: 500 });
}
