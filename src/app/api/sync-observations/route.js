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

  const payload = await getObservationData({ forceRefresh: true });
  return NextResponse.json({
    ok: true,
    source: payload.source,
    fetchedAt: payload.fetchedAt,
    meteoHubFilled: payload.meteoHub?.filled || 0,
    openMeteoFallbackCount: payload.openMeteoFallbackCount || 0,
    warning: payload.warning
  });
}
