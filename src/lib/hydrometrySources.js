import * as cheerio from "cheerio";
import { inflateRawSync } from "node:zlib";

export const HYDROMETRY_SOURCES = {
  activeHydrometers: {
    name: "Regione Toscana - Idrometri",
    url: "https://dati.toscana.it/dataset/idrometri",
    dataUrl: "https://geo.sir.toscana.it/geoserver/geo/ows?maxFeatures=300000&outputFormat=application%2Fjson&request=GetFeature&service=WFS&typeName=geo%3Acf_idrometri&version=1.0.0",
    format: "GeoJSON WFS",
    sourceType: "opendata_station"
  },
  stationArchive: {
    name: "Stazioni meteo-idrologiche",
    url: "https://dati.toscana.it/dataset/stazioni-meteo-idrologiche",
    dataUrl: "https://www.sir.toscana.it/archivio/dati.php?D=json_stations",
    reportsUrl: "https://www.sir.toscana.it/archivio/dati.php?D=json_reports",
    format: "GeoJSON JSON",
    sourceType: "sir_historical"
  },
  cfrRealtime: {
    name: "CFR Toscana - Idrometria",
    url: "https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro",
    detailUrl: "https://www.cfr.toscana.it/monitoraggio/dettaglio.php",
    detailUrls: [
      "https://www.cfr.toscana.it/monitoraggio/dettaglio.php",
      "http://www.cfr.toscana.it/monitoraggio/dettaglio.php"
    ],
    format: "HTML tabellare ed eventuale export Excel pubblicato nella pagina stazioni.php?type=idro",
    sourceType: "cfr_realtime"
  }
};

const CFR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = Number(process.env.HYDROMETRY_FETCH_TIMEOUT_MS || 9000);
const CFR_CONCURRENCY = Number(process.env.HYDROMETRY_CFR_CONCURRENCY || 6);

function withTimeout(ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timeout) };
}

export async function fetchText(url, { headers = {}, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: timeout.controller.signal,
      headers: {
        accept: "text/html,application/json,application/geo+json,*/*;q=0.8",
        "user-agent": CFR_USER_AGENT,
        ...headers
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status + " per " + url);
    return await response.text();
  } finally {
    timeout.clear();
  }
}

export async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: { accept: "application/json,application/geo+json,*/*;q=0.8", ...(options.headers || {}) }
  });
  return JSON.parse(text);
}

async function fetchBuffer(url, { headers = {}, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: timeout.controller.signal,
      headers: {
        accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/html,*/*;q=0.8",
        "user-agent": CFR_USER_AGENT,
        ...headers
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status + " per " + url);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    timeout.clear();
  }
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value)
    .replace(/\s+/g, " ")
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

function parseHydrometricMeters(value) {
  const text = cleanText(value);
  if (!text || /^TOS\d+/i.test(text) || /\d{2}\/\d{2}\/\d{4}/.test(text)) return null;

  const parsed = parseNumber(text);
  if (!Number.isFinite(parsed)) return null;

  // CFR espone l altezza idrometrica in metri. Convertiamo solo celle dichiarate in cm.
  if (/\bcm\b/i.test(text)) {
    const meters = parsed / 100;
    return Math.abs(meters) <= 30 ? Number(meters.toFixed(3)) : null;
  }

  // Scarta codici, quote altimetriche e valori non plausibili come livello idrometrico.
  return Math.abs(parsed) <= 30 ? parsed : null;
}

function parseFlowValue(value) {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) && Math.abs(parsed) < 10000 ? parsed : null;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\\(["'\\])/g, "$1")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDateTime(value) {
  const text = cleanText(value);
  const italian = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})[.:](\d{2})/);
  if (italian) {
    const [, day, month, year, hour, minute] = italian;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0).toISOString();
  }
  const iso = Date.parse(text);
  return Number.isFinite(iso) ? new Date(iso).toISOString() : null;
}

function normalizeSolarDateTime(value) {
  const text = cleanText(value);
  const italian = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})[.:](\d{2})/);
  if (!italian) {
    const shortItalian = text.match(/(\d{2})\/(\d{2})\s+(\d{2})[.:](\d{2})/);
    if (!shortItalian) return normalizeDateTime(value);
    const [, day, month, hour, minute] = shortItalian;
    return new Date(Date.UTC(
      new Date().getFullYear(),
      Number(month) - 1,
      Number(day),
      Number(hour) - 1,
      Number(minute),
      0,
      0
    )).toISOString();
  }

  const [, day, month, year, hour, minute] = italian;
  // CFR dichiara "ora solare": UTC+1. Salvando l istante in UTC, la UI italiana
  // lo visualizza automaticamente come ora legale quando la data cade in DST.
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 1,
    Number(minute),
    0,
    0
  )).toISOString();
}

function firstField(object, names) {
  for (const name of names) {
    if (object?.[name] !== undefined && object?.[name] !== null && object?.[name] !== "") return object[name];
  }
  return null;
}

function isLonLat(coordinates) {
  return Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Math.abs(Number(coordinates[0])) <= 180 &&
    Math.abs(Number(coordinates[1])) <= 90;
}

function getFeatureCoordinates(feature, fallbackFeature = null) {
  const primary = feature?.geometry?.coordinates;
  if (isLonLat(primary)) return { longitude: Number(primary[0]), latitude: Number(primary[1]) };

  const fallback = fallbackFeature?.geometry?.coordinates;
  if (isLonLat(fallback)) return { longitude: Number(fallback[0]), latitude: Number(fallback[1]) };

  return { longitude: null, latitude: null };
}

function getHistoricalHydrometrySource(feature, stationCode = null) {
  const consistency = feature?.properties?.Consistenza || {};
  const entry = Object.entries(consistency).find(([label, details]) =>
    /IDROMETRIA|IDROMETRI|LIVELLI/i.test(label) || /IDST=idro/i.test(details?.SorgenteDati || "")
  );
  if (entry) {
    const [label, details] = entry;
    return {
      historical_label: label,
      historical_url: details?.SorgenteDati || null,
      historical_years: Array.isArray(details?.Anni?.[0]) ? details.Anni[0] : [],
      historical_inferred: false
    };
  }

  return stationCode ? {
    historical_label: "IDROMETRIA - endpoint SIR candidato",
    historical_url: "https://www.sir.toscana.it/archivio/dati.php?IDST=idro&D=json&IDS=" + encodeURIComponent(stationCode),
    historical_years: [],
    historical_inferred: true
  } : { historical_label: null, historical_url: null, historical_years: [], historical_inferred: false };
}

export function normalizeHydrometryStation(activeFeature, archiveFeature = null) {
  const properties = activeFeature?.properties || {};
  const archiveProperties = archiveFeature?.properties || {};
  const coordinates = getFeatureCoordinates(activeFeature, archiveFeature);
  const stationCode = cleanText(firstField(properties, ["id_stazione", "Codice", "codice"]) || archiveProperties.Codice);
  const historical = getHistoricalHydrometrySource(archiveFeature, stationCode);

  return {
    station_id: stationCode,
    station_code: stationCode,
    station_name: cleanText(firstField(properties, ["nome", "Nome"]) || archiveProperties.Nome),
    river_name: cleanText(firstField(properties, ["asta", "corso_acqua", "fiume", "river_name"])) || null,
    basin: cleanText(firstField(properties, ["bacino", "Bacino", "gc", "zona"])) || null,
    municipality: cleanText(firstField(properties, ["comune", "Comune"])) || null,
    province: cleanText(firstField(properties, ["provincia", "Provincia"])) || null,
    alert_zone: cleanText(firstField(properties, ["zona", "Zona"])) || null,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    zero_hydrometric_m: parseNumber(firstField(properties, ["zero_idrometrico"])),
    altitude_m: parseNumber(firstField(properties, ["quota", "Quota mslm"])),
    historical_label: historical.historical_label,
    historical_url: historical.historical_url,
    historical_years: historical.historical_years,
    historical_inferred: historical.historical_inferred,
    source_type: HYDROMETRY_SOURCES.activeHydrometers.sourceType,
    source_url: HYDROMETRY_SOURCES.activeHydrometers.dataUrl,
    validated: true
  };
}

export function parseActiveHydrometersGeoJson(payload, archivePayload = null, { province = null } = {}) {
  const archiveByCode = new Map((archivePayload?.features || []).map((feature) => [feature?.properties?.Codice, feature]));
  return (payload?.features || [])
    .map((feature) => normalizeHydrometryStation(feature, archiveByCode.get(feature?.properties?.id_stazione)))
    .filter((station) => station.station_id)
    .filter((station) => !province || station.province === province);
}

export async function getHydrometryStations({ province = "FI" } = {}) {
  const [activePayload, archivePayload] = await Promise.allSettled([
    fetchJson(HYDROMETRY_SOURCES.activeHydrometers.dataUrl),
    fetchJson(HYDROMETRY_SOURCES.stationArchive.dataUrl)
  ]);

  if (activePayload.status !== "fulfilled") throw activePayload.reason;
  return parseActiveHydrometersGeoJson(
    activePayload.value,
    archivePayload.status === "fulfilled" ? archivePayload.value : null,
    { province }
  );
}

function parseQuotedArrayItems(rawItems) {
  const items = [];
  const pattern = /(["'])((?:\\.|(?!\1).)*?)\1/g;
  let match;
  while ((match = pattern.exec(rawItems))) items.push(cleanText(match[2]));
  return items;
}

export function parseCfrRealtimeDetail(html, station) {
  const source = String(html || "");
  const rows = [...String(html || "").matchAll(/\w+\[\d+\]\s*=\s*new\s+Array\((.*?)\);/g)]
    .map((match) => parseQuotedArrayItems(match[1]))
    .filter((items) => items.length >= 4);
  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  if (!latest) return null;

  const level = parseHydrometricMeters(latest[2]);
  const previousLevel = previous ? parseHydrometricMeters(previous[2]) : null;
  const flow = parseFlowValue(latest[3]);
  const warningMatch = source.match(/Livello\s*1\s*-&gt;\s*([-\d.,]+)\s*m/i) || source.match(/Livello\s*1\s*->\s*([-\d.,]+)\s*m/i);
  const dangerMatch = source.match(/Livello\s*2\s*-&gt;\s*([-\d.,]+)\s*m/i) || source.match(/Livello\s*2\s*->\s*([-\d.,]+)\s*m/i);
  const warning_m = parseHydrometricMeters(warningMatch?.[1]);
  const danger_m = parseHydrometricMeters(dangerMatch?.[1]);
  if (!Number.isFinite(level)) return null;

  return {
    station_id: station.station_id,
    station_code: station.station_code,
    station_name: station.station_name,
    river_name: station.river_name,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    measurement_time: normalizeDateTime(latest[1]),
    level_m: level,
    flow_mc_s: Number.isFinite(flow) ? flow : null,
    warning_m: Number.isFinite(warning_m) ? warning_m : null,
    danger_m: Number.isFinite(danger_m) ? danger_m : null,
    trend:
      Number.isFinite(previousLevel) && level > previousLevel ? "up" :
      Number.isFinite(previousLevel) && level < previousLevel ? "down" :
      "stable",
    source_type: HYDROMETRY_SOURCES.cfrRealtime.sourceType,
    source_url: HYDROMETRY_SOURCES.cfrRealtime.detailUrl,
    validated: false
  };
}


function normalizeNameKey(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeHeaderKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\u0394/g, "delta")
    .replace(/\u03b4/g, "delta")
    .replace(/Δ/g, "delta")
    .replace(/δ/g, "delta")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function getCfrPageMeasurementTime(text) {
  const match = String(text || "").match(/riferiti\s+al\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}[.:]\d{2})/i);
  return match ? normalizeSolarDateTime(match[1]) : null;
}

function discoverCfrPageLinks(html) {
  const $ = cheerio.load(html || "");
  return $("a")
    .map((_, element) => $(element).attr("href"))
    .get()
    .filter(Boolean)
    .map((href) => new URL(href, HYDROMETRY_SOURCES.cfrRealtime.url).toString());
}

function findStationForCfrRow({ stationText, codeText }, stations) {
  const code = cleanText(codeText);
  if (code) {
    const codeMatch = code.match(/TOS\d+/i);
    const normalizedCode = codeMatch ? codeMatch[0].toUpperCase() : code;
    const byCode = stations.find((station) => station.station_id === normalizedCode || station.station_code === normalizedCode);
    if (byCode) return byCode;
  }

  const key = normalizeNameKey(stationText);
  if (!key) return null;
  return stations.find((station) => {
    const stationKey = normalizeNameKey(station.station_name);
    return stationKey === key || stationKey.includes(key) || key.includes(stationKey);
  }) || null;
}

function findStationFromRow(row, stations) {
  const joined = cleanText(row.join(" "));
  const codeMatch = joined.match(/TOS\d+/i);
  if (codeMatch) {
    const code = codeMatch[0].toUpperCase();
    const byCode = stations.find((station) => station.station_id === code || station.station_code === code);
    if (byCode) return byCode;
  }

  const rowKey = normalizeNameKey(joined);
  return stations.find((station) => {
    const stationKey = normalizeNameKey(station.station_name);
    return stationKey && rowKey.includes(stationKey);
  }) || null;
}

function pickHeaderValue(row, headers, patterns) {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normalizeHeaderKey(headers[index]);
    if (patterns.some((pattern) => pattern.test(header))) return row[index];
  }
  return null;
}

function pickHeaderValueExcept(row, headers, includePatterns, excludePatterns = []) {
  for (let index = 0; index < headers.length; index += 1) {
    const header = normalizeHeaderKey(headers[index]);
    if (excludePatterns.some((pattern) => pattern.test(header))) continue;
    if (includePatterns.some((pattern) => pattern.test(header))) return row[index];
  }
  return null;
}

function getHeaderIndexes(headers, includePatterns, excludePatterns = []) {
  return headers
    .map((header, index) => ({ header: normalizeHeaderKey(header), index }))
    .filter(({ header }) => !excludePatterns.some((pattern) => pattern.test(header)))
    .filter(({ header }) => includePatterns.some((pattern) => pattern.test(header)))
    .map(({ index }) => index);
}

function getFirstHeaderValue(row, headers, includePatterns, excludePatterns = []) {
  const [index] = getHeaderIndexes(headers, includePatterns, excludePatterns);
  return index === undefined ? null : row[index];
}

function inferCfrRowFields(row, headers) {
  const codeIndex = row.findIndex((cell) => /^TOS\d+/i.test(cleanText(cell)));
  const codeText = pickHeaderValue(row, headers, [/codice/, /^id$/]) || (codeIndex >= 0 ? row[codeIndex] : null);
  const codeMatch = cleanText(codeText).match(/TOS\d+/i);
  const code = codeMatch ? codeMatch[0].toUpperCase() : cleanText(codeText);

  return {
    code,
    river: pickHeaderValue(row, headers, [/fiume/, /corso\s*acqua/]) || (codeIndex >= 0 ? row[codeIndex + 1] : null),
    stationName: pickHeaderValue(row, headers, [/stazione/, /nome/, /denominazione/]) || (codeIndex >= 0 ? row[codeIndex + 2] : null),
    province: pickHeaderValue(row, headers, [/provincia/]) || (codeIndex >= 0 ? row[codeIndex + 3] : null),
    zone: pickHeaderValue(row, headers, [/^zona$/]) || (codeIndex >= 0 ? row[codeIndex + 4] : null)
  };
}

function buildCfrOnlyStation(fields, stations) {
  const province = cleanText(fields.province);
  const allowedProvinces = new Set((stations || []).map((station) => cleanText(station.province)).filter(Boolean));
  if (allowedProvinces.size && province && !allowedProvinces.has(province)) return null;

  const code = cleanText(fields.code);
  const stationName = cleanText(fields.stationName).replace(/\s*\((?:GPRS|RADIO)\)\s*$/i, "");
  if (!code && !stationName) return null;

  const generatedCode = "CFR-" + normalizeNameKey(stationName || code).replace(/\s+/g, "-").toUpperCase();
  return {
    station_id: code || generatedCode,
    station_code: code || generatedCode,
    station_name: stationName || code,
    river_name: cleanText(fields.river) || null,
    basin: cleanText(fields.zone) || null,
    municipality: null,
    province: province || null,
    alert_zone: cleanText(fields.zone) || null,
    latitude: null,
    longitude: null,
    historical_url: null,
    historical_inferred: false,
    source_type: HYDROMETRY_SOURCES.cfrRealtime.sourceType,
    source_url: HYDROMETRY_SOURCES.cfrRealtime.url,
    validated: false
  };
}

function hasUsableHeaders(headers) {
  const joined = normalizeHeaderKey(headers.join(" "));
  return /attuale|liv\.?\s*1|livello\s*1|portata|ult\.?\s*dati|\bdata\b|variaz|delta\s*h\s*[136]|deltah[136]/.test(joined);
}

function isNumericCell(value) {
  return /^-?\d+(?:[.,]\d+)?/.test(cleanText(value));
}

function findStationCellIndex(row, station) {
  const stationKey = normalizeNameKey(station?.station_name);
  if (!stationKey) return -1;

  return row.findIndex((cell) => {
    const cellKey = normalizeNameKey(cell);
    return cellKey === stationKey || cellKey.includes(stationKey) || stationKey.includes(cellKey);
  });
}

function getPositionalCfrValues(row, station) {
  const codeIndex = row.findIndex((cell) => /^TOS\d+/i.test(cleanText(cell)));
  const stationIndex = findStationCellIndex(row, station);
  const searchStart = codeIndex >= 0
    ? codeIndex + 5
    : stationIndex >= 0
      ? stationIndex + 1
      : 0;
  const dataStart = row.findIndex((cell, index) => index >= searchStart && isNumericCell(cell));
  if (dataStart < 0) return null;
  const dataCells = row.slice(dataStart);

  // Ordine export CFR senza intestazioni: Codice, Fiume, Stazione, Provincia,
  // Zona, liv.2, liv.1, attuale livello, attuale portata, delta h1, delta h3,
  // delta h6, Data.
  const danger = parseHydrometricMeters(dataCells[0]);
  const warning = parseHydrometricMeters(dataCells[1]);
  const level = parseHydrometricMeters(dataCells[2]);
  const flow = parseFlowValue(dataCells[3]);
  const dateCell = row.find((cell) => /(?:\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2})\s+\d{2}[.:]\d{2}/.test(cleanText(cell)));

  const values = {
    level,
    warning,
    danger,
    flow,
    deltaH1: parseHydrometricMeters(dataCells[4]),
    deltaH3: parseHydrometricMeters(dataCells[5]),
    deltaH6: parseHydrometricMeters(dataCells[6]),
    measurementText: dateCell || null
  };
  return Number.isFinite(values.level) ? values : null;
}

function normalizeCfrBulkRow(row, headers, stations, sourceUrl, measurementTime) {
  if (!row?.length) return null;
  const fields = inferCfrRowFields(row, headers);
  const stationText = fields.stationName || row[1] || row[0];
  const codeText = fields.code || (/^TOS\d+/i.test(row[0]) ? row[0] : null);
  const hasOfficialCode = /^TOS\d+/i.test(cleanText(codeText));
  const station = hasOfficialCode
    ? findStationForCfrRow({ stationText: null, codeText }, stations) || buildCfrOnlyStation(fields, stations)
    : findStationForCfrRow({ stationText, codeText }, stations) ||
      findStationFromRow(row, stations) ||
      buildCfrOnlyStation(fields, stations);
  if (!station) return null;

  const positionalValues = getPositionalCfrValues(row, station);
  const fallbackValues = positionalValues || (hasUsableHeaders(headers) ? null : getPositionalCfrValues(row, station));
  const actualIndexes = getHeaderIndexes(headers, [/attuale/], [/liv\.?\s*[12]/, /livello\s*[12]/, /soglia/]);
  const levelIndex = actualIndexes.find((index) => !/portata/.test(normalizeHeaderKey(headers[index]))) ?? actualIndexes[0];
  const flowIndex = actualIndexes.find((index) => /portata/.test(normalizeHeaderKey(headers[index]))) ?? actualIndexes.find((index) => index !== levelIndex);
  const levelText = levelIndex === undefined ? null : row[levelIndex];
  const flowText = flowIndex === undefined
    ? pickHeaderValue(row, headers, [/portata/, /mc s/, /mc\/s/])
    : row[flowIndex];
  const warningText = getFirstHeaderValue(row, headers, [/liv\.?\s*1/, /livello\s*1/]);
  const dangerText = getFirstHeaderValue(row, headers, [/liv\.?\s*2/, /livello\s*2/]);
  const deltaH1Text = getFirstHeaderValue(row, headers, [/variaz.*delta\s*h\s*1/, /variaz.*deltah1/, /^delta\s*h\s*1$/, /^deltah1$/, /^h\s*1$/]);
  const deltaH3Text = getFirstHeaderValue(row, headers, [/variaz.*delta\s*h\s*3/, /variaz.*deltah3/, /^delta\s*h\s*3$/, /^deltah3$/, /^h\s*3$/]);
  const deltaH6Text = getFirstHeaderValue(row, headers, [/variaz.*delta\s*h\s*6/, /variaz.*deltah6/, /^delta\s*h\s*6$/, /^deltah6$/, /^h\s*6$/]);
  const measurementText = fallbackValues?.measurementText || getFirstHeaderValue(row, headers, [/ult\.?\s*dati/, /ultimo\s*dato/, /ultimi\s*dati/, /^data$/]);
  const level = fallbackValues?.level ?? parseHydrometricMeters(levelText);
  const flow = fallbackValues?.flow ?? parseFlowValue(flowText);
  const warning_m = fallbackValues?.warning ?? parseHydrometricMeters(warningText);
  const danger_m = fallbackValues?.danger ?? parseHydrometricMeters(dangerText);
  if (!Number.isFinite(level)) return null;

  return {
    station_id: station.station_id,
    station_code: station.station_code,
    station_name: station.station_name,
    river_name: station.river_name,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    measurement_time: normalizeSolarDateTime(measurementText) || measurementTime,
    level_m: level,
    flow_mc_s: Number.isFinite(flow) ? flow : null,
    warning_m: Number.isFinite(warning_m) ? warning_m : null,
    danger_m: Number.isFinite(danger_m) ? danger_m : null,
    delta_h1_m: fallbackValues?.deltaH1 ?? parseHydrometricMeters(deltaH1Text) ?? null,
    delta_h3_m: fallbackValues?.deltaH3 ?? parseHydrometricMeters(deltaH3Text) ?? null,
    delta_h6_m: fallbackValues?.deltaH6 ?? parseHydrometricMeters(deltaH6Text) ?? null,
    trend: null,
    source_type: HYDROMETRY_SOURCES.cfrRealtime.sourceType,
    source_url: sourceUrl,
    validated: false
  };
}

function combineHeaderRows(headerRows) {
  const width = Math.max(0, ...headerRows.map((row) => row.length));
  return Array.from({ length: width }, (_, columnIndex) => {
    const parts = headerRows
      .map((row) => cleanText(row[columnIndex]))
      .filter(Boolean);
    return [...new Set(parts)].join(" ");
  });
}

function buildHeaderRows($, trs) {
  const carries = [];
  return trs.map((tr) => {
    const row = [];
    let columnIndex = 0;

    $(tr).find("th").each((_, th) => {
      while (carries[columnIndex]?.remaining > 0) {
        row[columnIndex] = carries[columnIndex].text;
        carries[columnIndex].remaining -= 1;
        columnIndex += 1;
      }

      const text = cleanText($(th).text());
      const colspan = Math.max(1, Number($(th).attr("colspan")) || 1);
      const rowspan = Math.max(1, Number($(th).attr("rowspan")) || 1);
      for (let offset = 0; offset < colspan; offset += 1) {
        row[columnIndex + offset] = text;
        if (rowspan > 1) carries[columnIndex + offset] = { text, remaining: rowspan - 1 };
      }
      columnIndex += colspan;
    });

    while (carries[columnIndex]?.remaining > 0) {
      row[columnIndex] = carries[columnIndex].text;
      carries[columnIndex].remaining -= 1;
      columnIndex += 1;
    }

    return row;
  });
}

function parseCfrHtmlTables(html, stations, sourceUrl) {
  const $ = cheerio.load(html || "");
  const measurementTime = getCfrPageMeasurementTime($("body").text());
  const rows = [];

  $("table").each((_, table) => {
    const headerTrs = [];
    $(table).find("tr").each((__, tr) => {
      const ths = $(tr).find("th");
      if (ths.length) {
        headerTrs.push(tr);
        return;
      }
      const cells = $(tr).find("td").map((___, td) => cleanText($(td).text())).get();
      if (!cells.length) return;
      const headers = combineHeaderRows(buildHeaderRows($, headerTrs));
      const normalized = normalizeCfrBulkRow(cells, headers, stations, sourceUrl, measurementTime);
      if (normalized) rows.push(normalized);
    });
  });

  return rows;
}

function readUInt32(buffer, offset) {
  return offset >= 0 && offset + 4 <= buffer.length ? buffer.readUInt32LE(offset) : null;
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

function unzipXlsxEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return null;

  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");

    if (readUInt32(buffer, localOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (content) entries.set(fileName, content.toString("utf8"));
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function getXmlAttribute(xml, name) {
  const match = String(xml || "").match(new RegExp("\\s" + name + "=\"([^\"]*)\""));
  return match ? xmlDecode(match[1]) : "";
}

function columnIndexFromCellRef(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/)?.[0] || "";
  return letters.split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseXlsxSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)].map(([si]) =>
    [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("")
  );
}

function parseXlsxSheetRows(sheetXml, sharedStrings) {
  return [...String(sheetXml || "").matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map(([, , rowXml]) => {
    const cells = [];
    let maxIndex = -1;

    for (const [, attrs, cellXml] of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const ref = getXmlAttribute(attrs, "r");
      const type = getXmlAttribute(attrs, "t");
      const index = columnIndexFromCellRef(ref);
      if (index < 0) continue;
      maxIndex = Math.max(maxIndex, index);

      let value = "";
      const valueMatch = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/);
      if (valueMatch) {
        value = xmlDecode(valueMatch[1]);
        if (type === "s") value = sharedStrings[Number(value)] ?? value;
      } else {
        value = [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1])).join("");
      }
      cells[index] = cleanText(value);
    }

    return Array.from({ length: maxIndex + 1 }, (_, index) => cells[index] || "");
  });
}

function parseCfrXlsxRows(buffer, stations, sourceUrl, measurementTime) {
  const entries = unzipXlsxEntries(buffer);
  if (!entries) return null;

  const sharedStrings = parseXlsxSharedStrings(entries.get("xl/sharedStrings.xml"));
  const sheetName = [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const rows = parseXlsxSheetRows(entries.get(sheetName), sharedStrings);
  const headerIndex = rows.findIndex((row) => normalizeHeaderKey(row.join(" ")).includes("codice") && normalizeHeaderKey(row.join(" ")).includes("stazione"));
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex];
  return rows
    .slice(headerIndex + 1)
    .map((row) => normalizeCfrBulkRow(row, headers, stations, sourceUrl, measurementTime))
    .filter(Boolean);
}

function parseCfrBulkArrayRows(html, stations, sourceUrl) {
  const text = String(html || "");
  const measurementTime = getCfrPageMeasurementTime(text);
  return [...text.matchAll(/\w+\[\d+\]\s*=\s*new\s+Array\((.*?)\);/g)]
    .map((match) => parseQuotedArrayItems(match[1]))
    .map((row) => normalizeCfrBulkRow(row, [], stations, sourceUrl, measurementTime))
    .filter(Boolean);
}

export async function getHydrometryRealtimeBulk({ stations } = {}) {
  try {
    const html = await fetchText(HYDROMETRY_SOURCES.cfrRealtime.url, {
      timeoutMs: Number(process.env.HYDROMETRY_CFR_PAGE_TIMEOUT_MS || 8000)
    });
    const measurementTime = getCfrPageMeasurementTime(html);
    const discoveredLinks = discoverCfrPageLinks(html).filter((link) => /xls|xlsx|excel/i.test(link)).slice(0, 5);
    const tableRows = parseCfrHtmlTables(html, stations || [], HYDROMETRY_SOURCES.cfrRealtime.url);
    const excelResults = await Promise.allSettled(discoveredLinks.map(async (link) => {
      const exportBuffer = await fetchBuffer(link, { timeoutMs: Number(process.env.HYDROMETRY_CFR_PAGE_TIMEOUT_MS || 8000) });
      const xlsxRows = parseCfrXlsxRows(exportBuffer, stations || [], link, measurementTime);
      if (xlsxRows) return xlsxRows;
      return parseCfrHtmlTables(exportBuffer.toString("utf8"), stations || [], link);
    }));
    const excelRows = excelResults
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);
    const arrayRows = parseCfrBulkArrayRows(html, stations || [], HYDROMETRY_SOURCES.cfrRealtime.url);
    const byStation = new Map();
    [...arrayRows, ...tableRows, ...excelRows].forEach((row) => byStation.set(row.station_id, row));
    return {
      rows: [...byStation.values()],
      diagnostics: {
        mode: "cfr-page-bulk",
        tableRows: tableRows.length,
        excelRows: excelRows.length,
        arrayRows: arrayRows.length,
        discoveredLinks
      }
    };
  } catch (error) {
    return {
      rows: [],
      diagnostics: {
        mode: "cfr-page-bulk-error",
        error: error?.message || String(error),
        tableRows: 0,
        arrayRows: 0,
        discoveredLinks: []
      }
    };
  }
}

async function fetchCfrRealtimeForStation(station) {
  const query = "id=" + encodeURIComponent(station.station_id) + "&type=idro&" + Date.now();
  const bases = HYDROMETRY_SOURCES.cfrRealtime.detailUrls || [HYDROMETRY_SOURCES.cfrRealtime.detailUrl];

  for (const base of bases) {
    const separator = base.includes("?") ? "&" : "?";
    const url = base + separator + query;
    try {
      const html = await fetchText(url, { timeoutMs: Number(process.env.HYDROMETRY_CFR_TIMEOUT_MS || 5000) });
      const parsed = parseCfrRealtimeDetail(html, { ...station, source_url: url });
      if (parsed) return { ...parsed, source_url: url };
    } catch {
      // Prova il prossimo schema/protocollo CFR.
    }
  }

  return null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      try {
        results[currentIndex] = await mapper(items[currentIndex]);
      } catch (error) {
        results[currentIndex] = { error: error?.message || String(error), station_id: items[currentIndex]?.station_id };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getHydrometryRealtime({ stations, limit = 12 } = {}) {
  const selectedStations = (stations || []).slice(0, Math.max(1, Number(limit) || 12));
  const results = await mapWithConcurrency(selectedStations, CFR_CONCURRENCY, fetchCfrRealtimeForStation);
  return results.filter((item) => item && !item.error);
}

function normalizeHistoricalRow(row, station, sourceUrl) {
  if (!row || typeof row !== "object") return null;
  const dateValue = firstField(row, ["Data", "data", "DATA", "date", "giorno", "Giorno"]);
  const value = parseNumber(firstField(row, ["Valore", "valore", "VALORE", "Livello", "livello", "H", "h"]));
  if (!dateValue && !Number.isFinite(value)) return null;
  return {
    station_id: station.station_id,
    station_code: station.station_code,
    station_name: station.station_name,
    river_name: station.river_name,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    measurement_time: normalizeDateTime(dateValue) || cleanText(dateValue) || null,
    level_m: Number.isFinite(value) ? value : null,
    flow_mc_s: null,
    source_type: HYDROMETRY_SOURCES.stationArchive.sourceType,
    source_url: sourceUrl,
    validated: true,
    raw_flag: firstField(row, ["Flag", "flag", "FLAG"]) || null
  };
}

export function parseHistoricalHydrometry(payload, station, sourceUrl) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.features)
        ? payload.features.map((feature) => feature.properties || feature)
        : [];
  return rows.map((row) => normalizeHistoricalRow(row, station, sourceUrl)).filter(Boolean);
}

export async function getHydrometryHistorical({ station, limit = 120 } = {}) {
  if (!station?.historical_url) return [];
  const payload = await fetchJson(station.historical_url);
  return parseHistoricalHydrometry(payload, station, station.historical_url).slice(-Math.max(1, Number(limit) || 120));
}

export function buildHydrometrySourceMatrix() {
  return [
    {
      source: HYDROMETRY_SOURCES.activeHydrometers.name,
      content: "Stazioni idrometriche attive in telecontrollo",
      format: "GeoJSON WFS; SHP disponibile dalla scheda OpenData",
      applicationUse: "Anagrafica ufficiale attiva, codice stazione, comune, provincia, zona, zero idrometrico"
    },
    {
      source: HYDROMETRY_SOURCES.stationArchive.name,
      content: "Anagrafica estesa e link alle serie storiche disponibili",
      format: "GeoJSON JSON con campo Consistenza e SorgenteDati",
      applicationUse: "Coordinate WGS84, consistenza storica, collegamento alle misure validate/prevalidate/ricostruite"
    },
    {
      source: "SIR json_reports",
      content: "Report/metadati archivio storico esposti dalla scheda dataset",
      format: "JSON",
      applicationUse: "Ispezione report e possibili metadati; non usato come realtime"
    },
    {
      source: HYDROMETRY_SOURCES.cfrRealtime.name,
      content: "Livelli, soglie, portate, variazioni e ultimo dato operativo in tempo reale",
      format: "HTML/Excel dalla pagina stazioni.php?type=idro",
      applicationUse: "Dato realtime non validato; campi mappati da liv.1, liv.2, attuale, Portata, delta h1, delta h3, delta h6, Ult.dati"
    }
  ];
}
