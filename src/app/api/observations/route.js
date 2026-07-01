import { NextResponse } from "next/server";
import { getObservationData } from "@/lib/observationData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const payload = await getObservationData({ forceRefresh });
  return NextResponse.json(payload);
}
