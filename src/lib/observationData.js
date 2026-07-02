import { MEASUREMENT_TYPES, STATIONS_BY_TYPE, getStationPosition } from "@/lib/cfrStations";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TYPES = ["pluviometry", "thermometry", "anemometry", "hygrometry", "nivometry"];
const CACHE_TTL_MS = Number(process.env.OBSERVATION_CACHE_TTL_SECONDS || 900) * 1000;

// Query usate dalla mappa ufficiale MeteoHub /app/maps/observations.
// Idrometria e nivometria non risultano esposte nella mappa realtime MeteoHub: restano n.d. o fallback dove disponibile.
const METEOHUB_OBSERVATION_QUERIES = [
  {
    type: "thermometry",
    product: "B12101",
    timerange: "254,0,0",
    level: "103,2000,0,0"
  },
  {
    type: "pluviometry",
    product: "B13011",
    timerange: "1,0,3600",
    level: "1,0,0,0"
  },
  {
    type: "hygrometry",
    product: "B13003",
    timerange: "254,0,0",
    level: "103,2000,0,0"
  },
  {
    type: "anemometry",
    product: "B11002 or B11001",
    timerange: "254,0,0",
    level: "103,10000,0,0"
  }
];

function getCache() {
  if (!globalThis.__firenzeObservationCache) {
    globalThis.__firenzeObservationCache = { payload: null, updatedAt: 0 };
  }
  return globalThis.__firenzeObservationCache;
}

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasMeteoHubCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
}

function hasMeteoHubAccessKey() {
  return Boolean(process.env.METEOHUB_ACCESS_KEY || process.env.METEOHUB_API_KEY);
}

function encodeBasicAuthValue(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function getMeteoHubAccessKey() {
  return process.env.METEOHUB_ACCESS_KEY || process.env.METEOHUB_API_KEY || null;
}

function getMeteoHubBasicAuth() {
  const secret = getMeteoHubAccessKey() || process.env.METEOHUB_PASSWORD;
  if (!process.env.METEOHUB_USERNAME || !secret) return null;
  return encodeBasicAuthValue(`${process.env.METEOHUB_USERNAME}:${secret}`);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildHydroHistory(value) {
  return [5, 4, 3, 2, 1, 0].map((hoursAgo, index) => {
    const time = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit"
    });
    return {
      time,
      value: Number(Math.max(0, value + Math.sin(index * 0.9) * 0.16).toFixed(2)),
      warning: Number((value + 0.8).toFixed(2))
    };
  });
}

export function buildEmptyMeasurements(provider = "MeteoHub") {
  return Object.fromEntries(Object.entries(STATIONS_BY_TYPE).map(([type, stations]) => [
    type,
    stations.map((station) => ({
      ...station,
      ...getStationPosition(station.id),
      value: null,
      unit: MEASUREMENT_TYPES[type].unit,
      trend: null,
      updatedAt: null,
      history: undefined,
      warning: null,
      danger: null,
      unavailable: true,
      provider,
      real: false
    }))
  ]));
}


function readSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  if (typeof headers.raw === "function") return headers.raw()["set-cookie"] || [];
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function toCookieHeader(setCookieHeaders) {
  return setCookieHeaders
    .flatMap((item) => String(item).split(/,(?=\s*[^;,=]+=[^;,]+)/))
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function findAuthValue(payload, matcher) {
  if (!payload || typeof payload !== "object") return null;

  for (const [key, value] of Object.entries(payload)) {
    if (matcher(key) && typeof value === "string" && value.trim()) return value.trim();
  }

  for (const value of Object.values(payload)) {
    const nested = findAuthValue(value, matcher);
    if (nested) return nested;
  }

  return null;
}

function findToken(payload) {
  return findAuthValue(payload, (key) => /^(access_token|accessToken|token|jwt|id_token|idToken)$/i.test(key));
}

function findSessionId(payload) {
  return findAuthValue(payload, (key) => /(session|sessionid|sid|connect\.sid|auth)/i.test(key));
}

function readSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  if (typeof headers.raw === "function") return headers.raw()["set-cookie"] || [];
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function toCookieHeader(setCookieHeaders) {
  return setCookieHeaders
    .flatMap((item) => String(item).split(/,(?=\s*[^;,=]+=[^;,]+)/))
    .map((item) => item.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

function findAuthValue(payload, matcher) {
  if (!payload || typeof payload !== "object") return null;

  for (const [key, value] of Object.entries(payload)) {
    if (matcher(key) && typeof value === "string" && value.trim()) return value.trim();
  }

  for (const value of Object.values(payload)) {
    const nested = findAuthValue(value, matcher);
    if (nested) return nested;
  }

  return null;
}

function findToken(payload) {
  return findAuthValue(payload, (key) => /^(access_token|accessToken|token|jwt|id_token|idToken)$/i.test(key));
}

function findSessionId(payload) {
  return findAuthValue(payload, (key) => /(session|sessionid|sid|connect\.sid|auth)/i.test(key));
}

async function meteoHubLogin() {
  const response = await fetch(`${getBaseUrl()}/auth/login`, {
    method: "POST",
    cache: "no-store",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "accept": "application/json,text/plain,*/*"
    },
    body: JSON.stringify({
      username: process.env.METEOHUB_USERNAME,
      password: process.env.METEOHUB_PASSWORD
    })
  });

  const rawBody = await response.text();
  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = rawBody ? { raw: rawBody.slice(0, 300) } : {};
  }

  if ((!response.ok && response.status < 300) || response.status >= 400) {
    throw new Error(`Login MeteoHub HTTP ${response.status}`);
  }

  const token = findToken(payload);
  const setCookieHeaders = readSetCookieHeaders(response.headers);
  let cookie = toCookieHeader(setCookieHeaders);
  const sessionId = findSessionId(payload);
  if (!cookie && sessionId) cookie = `session=${sessionId}`;

  return {
    token,
    cookie,
    loginOk: true,
    authMode: token ? "bearer" : cookie ? "cookie" : "login-ok-no-session",
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : []
  };
}

function buildMeteoHubHeaders(session = {}) {
  const headers = { "accept": "application/json,text/plain,*/*" };
  if (session.extraHeaders) Object.assign(headers, session.extraHeaders);
  if (session.authHeader) headers.authorization = session.authHeader;
  if (!headers.authorization && session.token && session.authMode === "bearer") headers.authorization = `Bearer ${session.token}`;
  const basicAuth = getMeteoHubBasicAuth();
  if (!headers.authorization && basicAuth) headers.authorization = `Basic ${basicAuth}`;
  if (session.cookie) headers.cookie = session.cookie;
  return headers;
}
async function meteoHubFetchJson(path, session) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    cache: "no-store",
    headers: buildMeteoHubHeaders(session)
  });

  if (!response.ok) throw new Error(`MeteoHub ${path} HTTP ${response.status}`);
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}


function flattenRows(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.flatMap(flattenRows);
  if (typeof payload !== "object") return [];

  const candidates = [
    payload.data,
    payload.rows,
    payload.items,
    payload.results,
    payload.features,
    payload.observations,
    payload.measurements
  ].filter(Boolean);

  if (!candidates.length) return [payload];
  return candidates.flatMap(flattenRows);
}

function getRowValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
    if (row?.properties?.[key] !== undefined && row?.properties?.[key] !== null) return row.properties[key];
  }
  return null;
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function inferType(row) {
  const product = String(getRowValue(row, ["product", "quantity", "var", "variable", "code", "bcode"]) || "").toUpperCase();
  if (/B12101/.test(product)) return "thermometry";
  if (/B13011/.test(product)) return "pluviometry";
  if (/B13003/.test(product)) return "hygrometry";
  if (/B1100[12]/.test(product)) return "anemometry";

  const joined = JSON.stringify(row).toLowerCase();
  if (/hydro|idrom|water_level|river|livello|quota/.test(joined)) return "hydrometry";
  if (/pluv|rain|precip/.test(joined)) return "pluviometry";
  if (/temp|temper/.test(joined)) return "thermometry";
  if (/wind|vento|anem/.test(joined)) return "anemometry";
  if (/humid|umid|igrom/.test(joined)) return "hygrometry";
  if (/snow|neve|nivom/.test(joined)) return "nivometry";
  return null;
}

function findStation(type, row) {
  const stationId = String(getRowValue(row, ["id", "station_id", "stationId", "codice", "code", "ident", "ana_id", "station", "statid", "report"]) || "").trim();
  const stationName = String(getRowValue(row, ["name", "station_name", "stationName", "nome", "denominazione", "mobile_name", "ident"]) || "").trim().toLowerCase();
  const coordinates = Array.isArray(row?.geometry?.coordinates) ? row.geometry.coordinates : [];
  const lat = parseNumeric(getRowValue(row, ["lat", "latitude", "y"])) ?? parseNumeric(coordinates[1]);
  const lng = parseNumeric(getRowValue(row, ["lon", "lng", "longitude", "x"])) ?? parseNumeric(coordinates[0]);
  const catalog = STATIONS_BY_TYPE[type] || [];

  return catalog.find((station) => station.id === stationId)
    || catalog.find((station) => stationName && station.name.toLowerCase() === stationName)
    || catalog.find((station) => Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(station.lat - lat) < 0.025
      && Math.abs(station.lng - lng) < 0.025)
    || null;
}

function extractMeasurementValue(type, row) {
  const valueKeysByType = {
    pluviometry: ["precipitation", "rain", "pluv", "pioggia", "value", "val", "valore"],
    hydrometry: ["water_level", "level", "livello", "quota", "idrometro", "value", "valore"],
    thermometry: ["temperature", "temp", "temperatura", "value", "val", "valore"],
    anemometry: ["wind_speed", "wind", "vento", "velocita_vento", "value", "val", "valore"],
    hygrometry: ["relative_humidity", "humidity", "umidita", "igrometria", "value", "val", "valore"],
    nivometry: ["snow_depth", "snow", "neve", "nivometria", "value", "valore"]
  };

  return parseNumeric(getRowValue(row, valueKeysByType[type] || ["value", "valore"]));
}

function applyMeteoHubRows(measurements, rows, forcedType = null) {
  let filled = 0;

  rows.forEach((row) => {
    const type = forcedType || inferType(row);
    if (!type) return;

    const station = findStation(type, row);
    if (!station) return;

    const value = extractMeasurementValue(type, row);
    if (value === null || Number.isNaN(value)) return;

    const target = measurements[type]?.find((item) => item.id === station.id);
    if (!target) return;

    target.value = Number(value.toFixed(type === "hygrometry" ? 0 : 2));
    target.trend = "stable";
    target.updatedAt = String(getRowValue(row, ["time", "datetime", "date", "timestamp", "data"]) || "").slice(11, 16) || null;
    target.history = type === "hydrometry" ? buildHydroHistory(target.value) : undefined;
    target.warning = type === "hydrometry" ? Number((target.value + 0.8).toFixed(2)) : null;
    target.danger = type === "hydrometry" ? Number((target.value + 1.6).toFixed(2)) : null;
    target.unavailable = false;
    target.real = true;
    target.provider = "MeteoHub";
    target.modelled = false;
    filled += 1;
  });

  return filled;
}

function formatMeteoHubDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}`;
}

function buildMeteoHubObservationPath(query) {
  const now = new Date();
  const from = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 30 * 60 * 1000);
  const params = new URLSearchParams({
    q: [
      `reftime: >=${formatMeteoHubDate(from)}:00,<=${formatMeteoHubDate(to)}:59`,
      `product:${query.product}`,
      "license:CCBY_COMPLIANT",
      `timerange:${query.timerange}`,
      `level:${query.level}`
    ].join(";"),
    reliabilityCheck: "true",
    last: "true",
    ts: String(Date.now())
  });

  return `/api/observations?${params.toString()}`;
}

function getMeteoHubAuthCandidates(session) {
  const candidates = [session];
  const accessKey = getMeteoHubAccessKey();
  if (accessKey) {
    candidates.push({ authMode: "basic-access-key-as-username", authHeader: `Basic ${encodeBasicAuthValue(`${accessKey}:`)}` });
    if (process.env.METEOHUB_USERNAME) {
      candidates.push({ authMode: "basic-username-access-key", authHeader: `Basic ${encodeBasicAuthValue(`${process.env.METEOHUB_USERNAME}:${accessKey}`)}` });
    }
    candidates.push({ authMode: "bearer-access-key", authHeader: `Bearer ${accessKey}` });
    candidates.push({ authMode: "x-api-key", extraHeaders: { "x-api-key": accessKey } });
    candidates.push({ authMode: "x-access-key", extraHeaders: { "x-access-key": accessKey } });
  }

  return candidates.filter((candidate, index, all) =>
    index === all.findIndex((item) => item.authMode === candidate.authMode && item.authHeader === candidate.authHeader)
  );
}

async function fetchMeteoHubObservationRows(session) {
  let lastResults = [];

  for (const authCandidate of getMeteoHubAuthCandidates(session)) {
    const results = [];

    for (const query of METEOHUB_OBSERVATION_QUERIES) {
      try {
        const payload = await meteoHubFetchJson(buildMeteoHubObservationPath(query), authCandidate);
        results.push({ type: query.type, rows: flattenRows(payload), authMode: authCandidate.authMode });
      } catch (error) {
        results.push({ type: query.type, rows: [], warning: error.message, authMode: authCandidate.authMode });
      }
    }

    lastResults = results;
    if (results.some((item) => item.rows.length > 0)) return results;
    if (!results.every((item) => /HTTP 401|HTTP 403/.test(item.warning || ""))) return results;
  }

  return lastResults;
}

async function fetchMeteoHubMeasurements() {
  const session = hasMeteoHubAccessKey()
    ? { authMode: "basic-access-key-as-username", authHeader: `Basic ${encodeBasicAuthValue(`${getMeteoHubAccessKey()}:`)}` }
    : hasMeteoHubCredentials()
      ? { authMode: "basic-credentials" }
      : { authMode: "anonymous" };

  const measurements = buildEmptyMeasurements("MeteoHub");
  const observations = await fetchMeteoHubObservationRows(session);
  const warnings = observations.filter((item) => item.warning).map((item) => item.warning);
  let parsedRows = 0;
  let filled = 0;

  observations.forEach((item) => {
    parsedRows += item.rows.length;
    filled += applyMeteoHubRows(measurements, item.rows, item.type);
  });

  return {
    measurements,
    requests: [],
    filled,
    parsedRows,
    authMode: observations.find((item) => item.rows.length > 0)?.authMode || session.authMode,
    warning: filled
      ? null
      : warnings[0] || "MeteoHub raggiunto, ma le osservazioni realtime non sono ancora riconducibili alle stazioni configurate."
  };
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

async function augmentWithOpenMeteo(measurements) {
  const candidates = [];
  const seen = new Set();

  OPEN_METEO_TYPES.forEach((type) => {
    (measurements[type] || []).forEach((station) => {
      if (station.value !== null && station.value !== undefined) return;
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return;
      if (seen.has(station.id)) return;
      seen.add(station.id);
      candidates.push({ id: station.id, lat: station.lat, lng: station.lng });
    });
  });

  const byStationId = new Map();
  for (const stationBatch of chunk(candidates, 35)) {
    try {
      const responses = await fetchOpenMeteoBatch(stationBatch);
      responses.forEach((payload, index) => {
        const station = stationBatch[index];
        if (station) byStationId.set(station.id, payload);
      });
    } catch {
      // Fallback best-effort: se una batch fallisce, lasciamo n.d.
    }
  }

  let filled = 0;
  const nextMeasurements = Object.fromEntries(Object.entries(measurements).map(([type, stations]) => {
    if (!OPEN_METEO_TYPES.includes(type)) return [type, stations];

    return [type, stations.map((station) => {
      if (station.value !== null && station.value !== undefined) return station;
      const payload = byStationId.get(station.id);
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

export async function getObservationData({ forceRefresh = false } = {}) {
  const cache = getCache();
  const now = Date.now();

  if (!forceRefresh && cache.payload && now - cache.updatedAt < CACHE_TTL_MS) {
    return {
      ...cache.payload,
      cache: { hit: true, updatedAt: new Date(cache.updatedAt).toLocaleString("it-IT"), ttlSeconds: CACHE_TTL_MS / 1000 }
    };
  }

  let meteoHub;
  try {
    meteoHub = await fetchMeteoHubMeasurements();
  } catch (error) {
    meteoHub = {
      measurements: buildEmptyMeasurements("MeteoHub"),
      requests: [],
      filled: 0,
      warning: error.message
    };
  }

  const augmented = await augmentWithOpenMeteo(meteoHub.measurements);
  const sourceParts = ["MeteoHub"];
  if (augmented.filled) sourceParts.push("Open-Meteo fallback");

  const payload = {
    measurements: augmented.measurements,
    hydrometers: augmented.measurements.hydrometry,
    pluviometers: augmented.measurements.pluviometry,
    thermometers: augmented.measurements.thermometry,
    source: sourceParts.join(" + "),
    primarySource: "MeteoHub",
    fallbackSource: augmented.filled ? "Open-Meteo" : null,
    fetchedAt: new Date().toLocaleString("it-IT"),
    cache: { hit: false, updatedAt: new Date().toLocaleString("it-IT"), ttlSeconds: CACHE_TTL_MS / 1000 },
    meteoHub: {
      connected: !meteoHub.warning || meteoHub.filled > 0,
      filled: meteoHub.filled,
      requests: meteoHub.requests || [],
      authMode: meteoHub.authMode || null,
      parsedRows: meteoHub.parsedRows || 0,
      warning: meteoHub.warning || null
    },
    openMeteoFallbackCount: augmented.filled,
    warning: meteoHub.warning
      ? `${meteoHub.warning} Fallback Open-Meteo attivo per ${augmented.filled} valori meteo; idrometria solo da MeteoHub.`
      : augmented.filled
        ? `MeteoHub e sorgente primaria. Open-Meteo integra ${augmented.filled} valori meteo mancanti; idrometria solo da MeteoHub.`
        : null
  };

  cache.payload = payload;
  cache.updatedAt = now;
  return payload;
}
