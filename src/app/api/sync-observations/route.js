import { NextResponse } from "next/server";
import { getObservationData } from "@/lib/observationData";
import { STATIONS_BY_TYPE } from "@/lib/cfrStations";

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
  const batchSize = Number(searchParams.get("batchSize") || 18);
  const explicitType = searchParams.get("type");
  const explicitBatch = searchParams.get("batch");
  const rotatingTypes = Object.keys(STATIONS_BY_TYPE)
    .filter((item) => item !== "hydrometry")
    .filter((item) => item !== "nivometry" || process.env.ENABLE_NIVOMETRY_CACHE !== "0");
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  const type = explicitType || rotatingTypes[slot % rotatingTypes.length];
  const maxBatch = Math.max(1, Math.ceil((STATIONS_BY_TYPE[type]?.length || batchSize) / batchSize));
  const batch = explicitBatch || String(Math.floor(slot / rotatingTypes.length) % maxBatch);
  const payload = await getObservationData({ forceRefresh: true, batch, batchSize, type, realtime: true });

  return NextResponse.json({
    ok: true,
    source: payload.source,
    mode: payload.cfr?.mode,
    cache: payload.cache,
    batch: payload.cfr?.batch,
    batchSize,
    type: payload.cfr?.type,
    selectionSize: payload.cfr?.selectionSize,
    attemptedStations: payload.cfr?.lastBatchAttemptedStations ?? payload.cfr?.attemptedStations ?? 0,
    populatedStations: payload.cfr?.lastBatchPopulatedStations ?? payload.cfr?.populatedStations ?? 0,
    cachedPopulatedStations: payload.cfr?.populatedStations || 0,
    openMeteoFallbackCount: payload.openMeteoFallbackCount || 0,
    fetchedAt: payload.fetchedAt,
    warning: payload.warning
  }, {
    headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=3600" }
  });
}
