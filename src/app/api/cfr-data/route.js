import { NextResponse } from "next/server";
import { getObservationCacheHeaders, getObservationData } from "@/lib/observationData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "1";
  const selected = searchParams.get("selected") || "";
  const batch = searchParams.get("batch");
  const batchSize = Number(searchParams.get("batchSize") || 24);
  const type = searchParams.get("type");
  const realtime = Boolean(selected || batch !== null);
  const payload = await getObservationData({ forceRefresh, selected, batch, batchSize, type, realtime });

  return NextResponse.json({
    ...payload,
    source: "CFR Toscana",
    primarySource: "CFR Toscana"
  }, {
    headers: getObservationCacheHeaders({ realtime })
  });
}
