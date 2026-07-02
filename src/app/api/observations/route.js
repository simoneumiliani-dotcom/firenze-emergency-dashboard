import { NextResponse } from "next/server";
import { getObservationCacheHeaders, getObservationData } from "@/lib/observationData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const selected = searchParams.get("selected") || "";
  const realtime = Boolean(selected);
  const payload = await getObservationData({ forceRefresh, selected, realtime });

  return NextResponse.json(payload, {
    headers: getObservationCacheHeaders({ realtime })
  });
}
