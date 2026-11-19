import { NextResponse } from "next/server";
import { resolveProvider } from "@/lib/providers";
import type { CapabilitiesResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const { provider, live, configIssue } = resolveProvider();
  const body: CapabilitiesResponse = { capabilities: provider.capabilities(), live, configIssue };
  return NextResponse.json(body);
}
