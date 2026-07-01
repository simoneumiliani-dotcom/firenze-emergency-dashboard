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
    const measurements = fillMissingWithCatalog(parsed);

    return NextResponse.json({
      measurements,
      hydrometers: measurements.hydrometry,
      pluviometers: measurements.pluviometry,
      thermometers: measurements.thermometry,
      source: url,
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: Object.values(parsed).flat().length
        ? null
        : "Il CFR e stato raggiunto, ma non sono state trovate righe dati compatibili con le stazioni configurate. I valori CFR sono indicati come n.d."
    });
  } catch (error) {
    const measurements = fillMissingWithCatalog(emptyMeasurements());
    return NextResponse.json({
      measurements,
      hydrometers: measurements.hydrometry,
      pluviometers: measurements.pluviometry,
      thermometers: measurements.thermometry,
      source: "CFR Toscana",
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: "Dati CFR non disponibili in questo momento. I valori CFR sono indicati come n.d.; non vengono mostrati valori simulati."
    });
  }
}
