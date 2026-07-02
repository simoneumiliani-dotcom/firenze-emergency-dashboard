import { NextResponse } from "next/server";
import { getObservationData } from "@/lib/observationData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const { searchParams } = new URL(request.url);
  return request.headers.get("x-cron-secret") === secret || searchParams.get("secret") === secret;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const batch = searchParams.get("batch") || "0";
  const batchSize = Number(searchParams.get("batchSize") || 24);
  const type = searchParams.get("type") || null;
  const payload = await getObservationData({ forceRefresh: true, batch, batchSize, type, realtime: true });

  return NextResponse.json({
    ok: true,
    source: payload.source,
    mode: payload.cfr?.mode,
    batch: payload.cfr?.batch,
    type: payload.cfr?.type,
    selectionSize: payload.cfr?.selectionSize,
    attemptedStations: payload.cfr?.attemptedStations || 0,
    populatedStations: payload.cfr?.populatedStations || 0,
    openMeteoFallbackCount: payload.openMeteoFallbackCount || 0,
    fetchedAt: payload.fetchedAt,
    warning: payload.warning
  }, {
    headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=3600" }
  });
}
