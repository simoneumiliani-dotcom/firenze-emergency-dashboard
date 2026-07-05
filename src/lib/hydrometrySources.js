import * as cheerio from "cheerio";

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
    format: "HTML/JavaScript; eventuale export Excel se pubblicato nella pagina",
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
  if (!italian) return normalizeDateTime(value);

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
    const byCode = stations.find((station) => station.station_id === code || station.station_code === code);
    if (byCode) return byCode;
  }

  const key = normalizeNameKey(stationText);
  if (!key) return null;
  return stations.find((station) => {
    const stationKey = normalizeNameKey(station.station_name);
    return stationKey === key || stationKey.includes(key) || key.includes(stationKey);
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

function normalizeCfrBulkRow(row, headers, stations, sourceUrl, measurementTime) {
  if (!row?.length) return null;
  const stationText = pickHeaderValue(row, headers, [/stazione/, /nome/, /denominazione/]) || row[1] || row[0];
  const codeText = pickHeaderValue(row, headers, [/codice/, /^id$/]) || (/^TOS\d+/i.test(row[0]) ? row[0] : null);
  const station = findStationForCfrRow({ stationText, codeText }, stations);
  if (!station) return null;

  const levelText = pickHeaderValueExcept(row, headers, [/attuale/], [/liv\.?\s*[12]/, /livello\s*[12]/, /soglia/, /portata/]);
  const flowText = pickHeaderValue(row, headers, [/portata/, /mc s/, /mc\/s/]);
  const warningText = pickHeaderValueExcept(row, headers, [/liv\.?\s*1/, /livello\s*1/], []);
  const dangerText = pickHeaderValueExcept(row, headers, [/liv\.?\s*2/, /livello\s*2/], []);
  const deltaH1Text = pickHeaderValue(row, headers, [/variaz.*delta\s*h\s*1/, /variaz.*\bh1\b/]);
  const deltaH3Text = pickHeaderValue(row, headers, [/variaz.*delta\s*h\s*3/, /variaz.*\bh3\b/]);
  const deltaH6Text = pickHeaderValue(row, headers, [/variaz.*delta\s*h\s*6/, /variaz.*\bh6\b/]);
  const measurementText = pickHeaderValue(row, headers, [/ult\.?\s*dati/, /ultimo\s*dato/, /ultimi\s*dati/]);
  const level = parseHydrometricMeters(levelText);
  const flow = parseFlowValue(flowText);
  const warning_m = parseHydrometricMeters(warningText);
  const danger_m = parseHydrometricMeters(dangerText);
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
    delta_h1_m: parseHydrometricMeters(deltaH1Text),
    delta_h3_m: parseHydrometricMeters(deltaH3Text),
    delta_h6_m: parseHydrometricMeters(deltaH6Text),
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
    const discoveredLinks = discoverCfrPageLinks(html).filter((link) => /xls|xlsx|excel/i.test(link)).slice(0, 5);
    const tableRows = parseCfrHtmlTables(html, stations || [], HYDROMETRY_SOURCES.cfrRealtime.url);
    const excelResults = await Promise.allSettled(discoveredLinks.map(async (link) => {
      const exportText = await fetchText(link, {
        timeoutMs: Number(process.env.HYDROMETRY_CFR_PAGE_TIMEOUT_MS || 8000),
        headers: { accept: "application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,*/*;q=0.8" }
      });
      return parseCfrHtmlTables(exportText, stations || [], link);
    }));
    const excelRows = excelResults
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);
    const arrayRows = parseCfrBulkArrayRows(html, stations || [], HYDROMETRY_SOURCES.cfrRealtime.url);
    const byStation = new Map();
    [...tableRows, ...excelRows, ...arrayRows].forEach((row) => byStation.set(row.station_id, row));
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
      content: "Livelli e portate operative in tempo reale",
      format: "HTML/JavaScript dettaglio stazione",
      applicationUse: "Dato realtime non validato, da visualizzare con etichetta esplicita"
    }
  ];
}
