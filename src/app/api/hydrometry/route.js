import { NextResponse } from "next/server";
import {
  HYDROMETRY_SOURCES,
  buildHydrometrySourceMatrix,
  getHydrometryHistorical,
  getHydrometryRealtime,
  getHydrometryStations
} from "@/lib/hydrometrySources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get("province") || "FI";
  const realtime = searchParams.get("realtime") !== "0";
  const realtimeLimit = Number(searchParams.get("limit") || 12);
  const historicalStationId = searchParams.get("historicalStationId");
  const historicalLimit = Number(searchParams.get("historicalLimit") || 120);

  try {
    const stations = await getHydrometryStations({ province });
    const realtimeMeasurements = realtime
      ? await getHydrometryRealtime({ stations, limit: realtimeLimit })
      : [];
    const selectedHistoricalStation = historicalStationId
      ? stations.find((station) => station.station_id === historicalStationId)
      : null;
    const historicalMeasurements = selectedHistoricalStation
      ? await getHydrometryHistorical({ station: selectedHistoricalStation, limit: historicalLimit })
      : [];

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      province,
      sources: HYDROMETRY_SOURCES,
      sourceMatrix: buildHydrometrySourceMatrix(),
      stations,
      realtimeMeasurements,
      historicalMeasurements,
      counts: {
        stations: stations.length,
        realtime: realtimeMeasurements.length,
        historical: historicalMeasurements.length
      },
      notes: [
        "Il realtime CFR Toscana e' operativo e non validato.",
        "Lo storico SIR puo' contenere flag @/-9999, P, V o R secondo la scheda OpenData."
      ]
    }, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=1800" }
    });
  } catch (error) {
    return NextResponse.json({
      error: "Impossibile recuperare i dati idrometrici ufficiali.",
      message: error?.message || String(error),
      sources: HYDROMETRY_SOURCES,
      sourceMatrix: buildHydrometrySourceMatrix(),
      stations: [],
      realtimeMeasurements: [],
      historicalMeasurements: []
    }, { status: 502 });
  }
}
