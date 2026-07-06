import { NextResponse } from "next/server";
import {
  HYDROMETRY_SOURCES,
  buildHydrometryStationMapDiagnostics,
  buildHydrometrySourceMatrix,
  getHydrometryHistorical,
  getHydrometryRealtimeBulk,
  getHydrometryStations
} from "@/lib/hydrometrySources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const province = searchParams.get("province") || "FI";
  const realtime = searchParams.get("realtime") !== "0";
  const realtimeLimitParam = searchParams.get("limit");
  const historicalRequested = searchParams.get("historical") === "1";
  const historicalStationId = historicalRequested ? searchParams.get("historicalStationId") : null;
  const historicalLimit = Number(searchParams.get("historicalLimit") || 120);

  try {
    const stations = await getHydrometryStations({ province });
    const realtimeLimit = realtimeLimitParam === "all"
      ? stations.length
      : Math.min(stations.length, Math.max(1, Number(realtimeLimitParam || stations.length) || stations.length));
    const bulkRealtime = realtime
      ? await getHydrometryRealtimeBulk({ stations })
      : { rows: [], diagnostics: null };
    const realtimeByStation = new Map();
    bulkRealtime.rows.forEach((row) => realtimeByStation.set(row.station_id, row));
    const realtimeMeasurements = [...realtimeByStation.values()];
    const selectedHistoricalStation = historicalStationId
      ? stations.find((station) => station.station_id === historicalStationId)
      : null;
    let historicalMeasurements = [];
    let historicalError = null;
    if (selectedHistoricalStation) {
      try {
        historicalMeasurements = await getHydrometryHistorical({ station: selectedHistoricalStation, limit: historicalLimit });
      } catch (error) {
        historicalError = error?.message || String(error);
      }
    }

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      province,
      sources: HYDROMETRY_SOURCES,
      sourceMatrix: buildHydrometrySourceMatrix(),
      stations,
      realtimeMeasurements,
      historicalMeasurements,
      historicalError,
      counts: {
        stations: stations.length,
        realtime: realtimeMeasurements.length,
        historical: historicalMeasurements.length
      },
      stationMapDiagnostics: buildHydrometryStationMapDiagnostics(stations),
      realtimeDiagnostics: {
        attemptedStations: realtime ? realtimeLimit : 0,
        bulkRows: bulkRealtime.rows.length,
        bulk: bulkRealtime.diagnostics,
        realtimeSourceUrl: HYDROMETRY_SOURCES.cfrRealtime.url,
        mergedRows: realtimeMeasurements.length
      },
      notes: [
        "Il realtime idrometrico e' letto esclusivamente da CFR Toscana stazioni.php?type=idro e dagli export pubblicati in quella pagina.",
        "Il realtime CFR Toscana e' operativo e non validato.",
        "Lo storico SIR puo' contenere flag @/-9999, P, V o R secondo la scheda OpenData."
      ]
    }, {
      headers: { "Cache-Control": realtime ? "no-store" : "s-maxage=300, stale-while-revalidate=1800" }
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
