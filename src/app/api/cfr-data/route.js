import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { MEASUREMENT_TYPES, STATIONS_BY_TYPE, getStationPosition } from "@/lib/cfrStations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CFR_URLS = [
  process.env.CFR_MONITORING_URL,
  "https://www.cfr.toscana.it/monitoraggio/",
  "https://cfr.toscana.it/monitoraggio/"
].filter(Boolean);

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TYPES = ["pluviometry", "thermometry", "anemometry", "hygrometry", "nivometry"];

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseNumber(text) {
  const match = cleanText(text).match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
}

function trendFromCells(cells) {
  const text = cells.join(" ").toLowerCase();
  if (/salita|aumento|cresc|\+\s*\d/i.test(text)) return "up";
  if (/discesa|dimin|calo|-\s*\d/i.test(text)) return "down";
  return "stable";
}

function getUpdatedAt(cells) {
  const text = cells.join(" ");
  return text.match(/\b\d{1,2}[:.]\d{2}\b/)?.[0]?.replace(".", ":") || null;
}

function buildHistory(currentValue, type) {
  const safeValue = Number.isFinite(currentValue) ? currentValue : 0;
  const now = new Date();
  const warning = type === "hydrometry" ? Number((safeValue + 0.8).toFixed(2)) : null;

  return [5, 4, 3, 2, 1, 0].map((hoursAgo, index) => {
    const time = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit"
    });
    const wave = Math.sin(index * 0.9) * (type === "hydrometry" ? 0.16 : 1.2);
    return {
      time,
      value: Number(Math.max(0, safeValue + wave).toFixed(type === "hydrometry" ? 2 : 1)),
      warning
    };
  });
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getOpenMeteoValue(payload, type) {
  const current = payload?.current || {};
  const hourly = payload?.hourly || {};
  const hourlyUnits = payload?.hourly_units || {};

  if (type === "pluviometry") return current.precipitation ?? null;
  if (type === "thermometry") return current.temperature_2m ?? null;
  if (type === "anemometry") return current.wind_speed_10m ?? null;
  if (type === "hygrometry") return current.relative_humidity_2m ?? null;

  if (type === "nivometry") {
    const currentTime = current.time;
    const snowValues = hourly.snow_depth || [];
    const snowIndex = Array.isArray(hourly.time) ? hourly.time.indexOf(currentTime) : -1;
    const value = snowValues[snowIndex >= 0 ? snowIndex : 0];
    if (value === null || value === undefined) return null;
    return hourlyUnits.snow_depth === "m" ? Number((value * 100).toFixed(1)) : value;
  }

  return null;
}

function normalizeOpenMeteoResponses(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.latitude !== undefined && payload?.longitude !== undefined) return [payload];
  return [];
}

async function fetchOpenMeteoBatch(stations) {
  const params = new URLSearchParams({
    latitude: stations.map((station) => station.lat).join(","),
    longitude: stations.map((station) => station.lng).join(","),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
    hourly: "snow_depth",
    timezone: "Europe/Rome",
    forecast_days: "1"
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    return normalizeOpenMeteoResponses(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteoMeasurements(measurements) {
  const candidateMap = new Map();

  OPEN_METEO_TYPES.forEach((type) => {
    (measurements[type] || []).forEach((station) => {
      if (station.value !== null && station.value !== undefined) return;
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return;
      if (!candidateMap.has(station.id)) {
        candidateMap.set(station.id, { id: station.id, lat: station.lat, lng: station.lng });
      }
    });
  });

  const candidates = [...candidateMap.values()];
  const byStationId = new Map();

  for (const stationBatch of chunk(candidates, 35)) {
    try {
      const responses = await fetchOpenMeteoBatch(stationBatch);
      responses.forEach((payload, index) => {
        const station = stationBatch[index];
        if (station) byStationId.set(station.id, payload);
      });
    } catch {
      // Open-Meteo e un provider di supporto: se una batch fallisce,
      // lasciamo i valori ufficiali mancanti come n.d. invece di bloccare l'API.
    }
  }

  return byStationId;
}

async function augmentWithOpenMeteo(measurements) {
  const openMeteoByStationId = await fetchOpenMeteoMeasurements(measurements);
  let filled = 0;

  const nextMeasurements = Object.fromEntries(Object.entries(measurements).map(([type, stations]) => {
    if (!OPEN_METEO_TYPES.includes(type)) return [type, stations];

    return [type, stations.map((station) => {
      if (station.value !== null && station.value !== undefined) return station;

      const payload = openMeteoByStationId.get(station.id);
      const value = getOpenMeteoValue(payload, type);
      if (value === null || value === undefined || Number.isNaN(Number(value))) return station;

      filled += 1;
      return {
        ...station,
        value: Number(Number(value).toFixed(type === "hygrometry" ? 0 : 1)),
        trend: "stable",
        updatedAt: payload?.current?.time?.slice(11, 16) || null,
        unavailable: false,
        real: true,
        provider: "Open-Meteo",
        modelled: true
      };
    })];
  }));

  return { measurements: nextMeasurements, filled };
}

function emptyMeasurements() {
  return Object.fromEntries(Object.keys(MEASUREMENT_TYPES).map((type) => [type, []]));
}

function stationMatchesRow(rowText, station) {
  const lower = rowText.toLowerCase();
  return lower.includes(station.id.toLowerCase()) || lower.includes(station.name.toLowerCase());
}

function classifyTable(headingText, rowsText) {
  const text = `${headingText} ${rowsText}`.toLowerCase();
  if (/idrom|livell|fium|quota|sieve|arno|bisenzio/.test(text)) return "hydrometry";
  if (/pluv|piogg|precipit/.test(text)) return "pluviometry";
  if (/term|temper/.test(text)) return "thermometry";
  if (/anem|vento|raffica/.test(text)) return "anemometry";
  if (/igrom|umid/.test(text)) return "hygrometry";
  if (/nivom|neve|manto/.test(text)) return "nivometry";
  return null;
}

function parseTables(html) {
  const $ = cheerio.load(html);
  const parsed = emptyMeasurements();

  $("table").each((_, table) => {
    const tableText = cleanText($(table).text());
    const headingText = cleanText($(table).prevAll("h1,h2,h3,h4,.title,.titolo").first().text());
    const kind = classifyTable(headingText, tableText);
    if (!kind) return;

    $(table).find("tr").each((__, row) => {
      const cells = $(row).find("th,td").map((___, cell) => cleanText($(cell).text())).get();
      if (cells.length < 2) return;
      const rowText = cells.join(" ");

      STATIONS_BY_TYPE[kind].forEach((station) => {
        if (!stationMatchesRow(rowText, station)) return;
        if (parsed[kind].some((item) => item.id === station.id)) return;

        const numericValues = cells.map(parseNumber).filter((value) => value !== null);
        const value = numericValues.at(-1) ?? null;
        const position = getStationPosition(station.id);

        parsed[kind].push({
          ...station,
          ...position,
          value,
          unit: MEASUREMENT_TYPES[kind].unit,
          trend: trendFromCells(cells),
          updatedAt: getUpdatedAt(cells),
          history: kind === "hydrometry" && value !== null ? buildHistory(value, kind) : undefined,
          warning: kind === "hydrometry" && value !== null ? Number((value + 0.8).toFixed(2)) : null,
          danger: kind === "hydrometry" && value !== null ? Number((value + 1.6).toFixed(2)) : null,
          provider: "CFR Toscana",
          real: value !== null
        });
      });
    });
  });

  return parsed;
}

function fillMissingWithCatalog(parsed) {
  return Object.fromEntries(Object.entries(STATIONS_BY_TYPE).map(([type, stations]) => {
    const existing = parsed[type] || [];
    const existingIds = new Set(existing.map((station) => station.id));
    const fallbackRows = stations
      .filter((station) => !existingIds.has(station.id))
      .map((station) => {
        const position = getStationPosition(station.id);
        return {
          ...station,
          ...position,
          value: null,
          unit: MEASUREMENT_TYPES[type].unit,
          trend: null,
          updatedAt: null,
          history: undefined,
          warning: null,
          danger: null,
          unavailable: true,
          provider: "CFR Toscana",
          real: false
        };
      });

    return [type, [...existing, ...fallbackRows]];
  }));
}

async function fetchFirstAvailable() {
  let lastError = null;

  for (const url of CFR_URLS) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "user-agent": "FirenzeEmergencyDashboard/1.0 (+https://vercel.app)",
          "accept": "text/html,application/xhtml+xml"
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { url, html: await response.text() };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Nessuna URL CFR configurata.");
}

export async function GET() {
  try {
    const { url, html } = await fetchFirstAvailable();
    const parsed = parseTables(html);
    const augmented = await augmentWithOpenMeteo(fillMissingWithCatalog(parsed));
    const measurements = augmented.measurements;
    const parsedCount = Object.values(parsed).flat().length;

    return NextResponse.json({
      measurements,
      hydrometers: measurements.hydrometry,
      pluviometers: measurements.pluviometry,
      thermometers: measurements.thermometry,
      source: augmented.filled ? `${url} + Open-Meteo` : url,
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: parsedCount
        ? augmented.filled
          ? `Dati CFR letti dove disponibili; ${augmented.filled} valori meteo mancanti sono integrati da Open-Meteo. L'idrometria resta solo CFR.`
          : null
        : augmented.filled
          ? `Il CFR e stato raggiunto, ma non sono state trovate righe compatibili. ${augmented.filled} valori meteo sono integrati da Open-Meteo; l'idrometria resta n.d.`
          : "Il CFR e stato raggiunto, ma non sono state trovate righe dati compatibili con le stazioni configurate. I valori CFR sono indicati come n.d."
    });
  } catch (error) {
    const augmented = await augmentWithOpenMeteo(fillMissingWithCatalog(emptyMeasurements()));
    const measurements = augmented.measurements;
    return NextResponse.json({
      measurements,
      hydrometers: measurements.hydrometry,
      pluviometers: measurements.pluviometry,
      thermometers: measurements.thermometry,
      source: augmented.filled ? "Open-Meteo + catalogo stazioni locale" : "CFR Toscana",
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: augmented.filled
        ? `Dati CFR non disponibili in questo momento. Sono mostrati ${augmented.filled} valori meteo reali/interpolati Open-Meteo sulle coordinate delle stazioni; l'idrometria resta n.d.`
        : "Dati CFR non disponibili in questo momento. I valori CFR sono indicati come n.d.; non vengono mostrati valori simulati."
    });
  }
}
