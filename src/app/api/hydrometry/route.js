import { NextResponse } from "next/server";
import {
  HYDROMETRY_SOURCES,
  buildHydrometrySourceMatrix,
  getHydrometryHistorical,
  getHydrometryRealtime,
  getHydrometryStations
} from "@/lib/hydrometrySources";
import { getObservationData } from "@/lib/observationData";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeObservationRealtime(station, row) {
  if (!row || row.value === null || row.value === undefined) return null;
  return {
    station_id: station.station_id,
    station_code: station.station_code,
    station_name: station.station_name,
    river_name: station.river_name,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    measurement_time: row.updatedAt || null,
    level_m: Number(row.value),
    flow_mc_s: null,
    trend: row.trend || null,
    source_type: "cfr_realtime",
    source_url: row.extra?.source_url || HYDROMETRY_SOURCES.cfrRealtime.detailUrl,
    validated: false
  };
}

async function getRealtimeFallback(stations, limit) {
  const selectedStations = stations.slice(0, Math.max(1, Number(limit) || 12));
  const selected = selectedStations.map((station) => "hydrometry:" + station.station_id).join(",");
  if (!selected) return [];
  const payload = await getObservationData({ selected, realtime: true });
  const rows = payload?.measurements?.hydrometry || [];
  return selectedStations
    .map((station) => normalizeObservationRealtime(station, rows.find((row) => row.id === station.station_id)))
    .filter(Boolean);
}

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
    const directRealtime = realtime
      ? await getHydrometryRealtime({ stations, limit: realtimeLimit })
      : [];
    const fallbackRealtime = realtime
      ? await getRealtimeFallback(stations, realtimeLimit)
      : [];
    const realtimeByStation = new Map();
    fallbackRealtime.forEach((row) => realtimeByStation.set(row.station_id, row));
    directRealtime.forEach((row) => realtimeByStation.set(row.station_id, row));
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
      realtimeDiagnostics: {
        attemptedStations: realtime ? realtimeLimit : 0,
        directRows: directRealtime.length,
        fallbackRows: fallbackRealtime.length,
        mergedRows: realtimeMeasurements.length
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
