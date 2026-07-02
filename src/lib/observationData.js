import { MEASUREMENT_TYPES, STATIONS_BY_TYPE, getStationPosition } from "@/lib/cfrStations";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TYPES = ["pluviometry", "thermometry", "anemometry", "hygrometry", "nivometry"];
const CACHE_TTL_MS = Number(process.env.OBSERVATION_CACHE_TTL_SECONDS || 900) * 1000;
const CFR_FETCH_DEADLINE_MS = Number(process.env.CFR_FETCH_DEADLINE_MS || 8500);
const DEFAULT_CACHE_MAX_AGE_SECONDS = Number(process.env.OBSERVATION_CACHE_MAX_AGE_SECONDS || 300);
const CFR_STATION_TIMEOUT_MS = Number(process.env.CFR_STATION_TIMEOUT_MS || 3500);
const PERSISTED_CACHE_KEY = process.env.OBSERVATION_CACHE_KEY || "firenze:observation-cache:v1";
const PERSISTED_CACHE_TTL_SECONDS = Number(process.env.OBSERVATION_PERSISTED_CACHE_TTL_SECONDS || 21600);

const CFR_TYPES = {
  hydrometry: "idro",
  pluviometry: "pluvio",
  thermometry: "termo",
  anemometry: "anemo",
  hygrometry: "igro"
};

const CFR_DETAIL_BASES = [
  process.env.CFR_DETAIL_BASE_URL,
  "https://www.cfr.toscana.it/monitoraggio/dettaglio.php",
  "http://www.cfr.toscana.it/monitoraggio/dettaglio.php"
].filter(Boolean);

const CFR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getCache() {
  if (!globalThis.__firenzeObservationCache) {
    globalThis.__firenzeObservationCache = { payload: null, updatedAt: 0 };
  }
  return globalThis.__firenzeObservationCache;
}

function hasPersistentCache() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getKvUrl(path) {
  return process.env.KV_REST_API_URL.replace(/\/+$/, "") + path;
}

async function readPersistedCache() {
  if (!hasPersistentCache()) return null;

  try {
    const response = await fetch(getKvUrl("/get/" + encodeURIComponent(PERSISTED_CACHE_KEY)), {
      headers: { Authorization: "Bearer " + process.env.KV_REST_API_TOKEN },
      cache: "no-store"
    });
    if (!response.ok) return null;

    const body = await response.json();
    const value = body?.result;
    if (!value) return null;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

async function writePersistedCache(payload) {
  if (!hasPersistentCache()) return false;

  try {
    const response = await fetch(getKvUrl("/pipeline"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.KV_REST_API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["SET", PERSISTED_CACHE_KEY, JSON.stringify(payload), "EX", PERSISTED_CACHE_TTL_SECONDS]
      ])
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function readSharedCache() {
  const cache = getCache();
  const now = Date.now();
  if (cache.payload && now - cache.updatedAt < CACHE_TTL_MS) return { payload: cache.payload, mode: "memory" };

  const persisted = await readPersistedCache();
  if (!persisted?.measurements) return null;

  cache.payload = persisted;
  cache.updatedAt = now;
  return { payload: persisted, mode: hasPersistentCache() ? "vercel-kv" : "memory" };
}

async function writeSharedCache(payload) {
  const cache = getCache();
  cache.payload = payload;
  cache.updatedAt = Date.now();
  const persisted = await writePersistedCache(payload);
  return persisted ? "vercel-kv" : "memory";
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function parseNumber(text) {
  const match = String(text || "").replace(/\s+/g, " ").match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : null;
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

export function buildEmptyMeasurements(provider = "CFR Toscana") {
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

function getUpdatedAt(dateTimeText) {
  const match = String(dateTimeText || "").match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2})[.:](\d{2})/);
  if (!match) return null;
  return match[2] + ":" + match[3];
}

function getWarningThreshold(type, value) {
  if (!Number.isFinite(value)) return null;
  if (type === "hydrometry") return Number((value + 0.8).toFixed(2));
  if (type === "pluviometry") return 25;
  if (type === "anemometry") return 50;
  return null;
}

function getDangerThreshold(type, value) {
  if (!Number.isFinite(value)) return null;
  if (type === "hydrometry") return Number((value + 1.4).toFixed(2));
  if (type === "pluviometry") return 50;
  if (type === "anemometry") return 80;
  return null;
}

function normalizeCfrValue(type, rawValue, secondaryValue) {
  if (type === "anemometry") {
    const [speedRaw, gustRaw] = String(rawValue || "").split("/");
    const speedMs = parseNumber(speedRaw);
    const gustMs = parseNumber(gustRaw);
    return {
      value: Number.isFinite(speedMs) ? Number((speedMs * 3.6).toFixed(1)) : null,
      extra: {
        direction: String(secondaryValue || "").trim() || null,
        gust: Number.isFinite(gustMs) ? Number((gustMs * 3.6).toFixed(1)) : null
      }
    };
  }

  const value = parseNumber(rawValue);
  return {
    value: Number.isFinite(value) ? value : null,
    extra: secondaryValue ? { secondaryValue: String(secondaryValue).trim() } : undefined
  };
}

function parseCfrDetail(text, type) {
  // Logica ricavata dal custom component Home Assistant cfr-toscana.
  const matches = [...String(text || "").matchAll(/\w+\[\d+\]\s*=\s*new Array\("(.*?)","(.*?)","(.*?)","(.*?)"\);/g)];
  if (!matches.length) return null;

  const previous = matches.length > 1 ? normalizeCfrValue(type, matches[matches.length - 2][3], matches[matches.length - 2][4]).value : null;
  const last = matches[matches.length - 1];
  const normalized = normalizeCfrValue(type, last[3], last[4]);
  if (!Number.isFinite(normalized.value)) return null;

  return {
    value: normalized.value,
    trend:
      Number.isFinite(previous) && normalized.value > previous ? "up" :
      Number.isFinite(previous) && normalized.value < previous ? "down" :
      "stable",
    updatedAt: getUpdatedAt(last[2]),
    extra: normalized.extra
  };
}

async function fetchCfrStation(station, type) {
  const cfrType = CFR_TYPES[type];
  if (!cfrType) return null;
  const query = "id=" + encodeURIComponent(station.id) + "&type=" + encodeURIComponent(cfrType) + "&" + Date.now();

  for (const base of CFR_DETAIL_BASES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CFR_STATION_TIMEOUT_MS);
    try {
      const separator = base.includes("?") ? "&" : "?";
      const response = await fetch(base + separator + query, {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": CFR_USER_AGENT
        }
      });
      if (!response.ok) continue;
      const parsed = parseCfrDetail(await response.text(), type);
      if (parsed) return parsed;
    } catch {
      // Proviamo il prossimo endpoint CFR configurato.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function normalizeSelectionItem(item) {
  if (!item) return null;
  if (typeof item === "string") {
    const [type, id] = item.split(":");
    if (!type || !id || !STATIONS_BY_TYPE[type]) return null;
    const station = STATIONS_BY_TYPE[type].find((candidate) => candidate.id === id);
    return station ? { type, station } : null;
  }
  if (item.type && item.id && STATIONS_BY_TYPE[item.type]) {
    const station = STATIONS_BY_TYPE[item.type].find((candidate) => candidate.id === item.id);
    return station ? { type: item.type, station } : null;
  }
  return null;
}

export function parseSelectedStations(value) {
  if (!value) return [];
  const rawItems = Array.isArray(value) ? value : String(value).split(",");
  const map = new Map();
  rawItems.forEach((item) => {
    const normalized = normalizeSelectionItem(item);
    if (normalized) map.set(normalized.type + ":" + normalized.station.id, normalized);
  });
  return [...map.values()];
}

function buildBatchSelection({ type, batch = 0, batchSize = 24 } = {}) {
  const types = type && STATIONS_BY_TYPE[type] ? [type] : Object.keys(STATIONS_BY_TYPE).filter((item) => CFR_TYPES[item]);
  const jobs = types.flatMap((itemType) => (STATIONS_BY_TYPE[itemType] || []).map((station) => ({ type: itemType, station })));
  const safeBatch = Math.max(0, Number(batch) || 0);
  const safeBatchSize = Math.max(1, Math.min(60, Number(batchSize) || 24));
  return jobs.slice(safeBatch * safeBatchSize, safeBatch * safeBatchSize + safeBatchSize);
}

async function fetchCfrMeasurementsForSelection(selection) {
  const measurements = buildEmptyMeasurements("CFR Toscana");
  let filled = 0;
  let attempted = 0;
  const startedAt = Date.now();
  const jobs = selection.filter(({ type }) => CFR_TYPES[type]);

  for (const jobBatch of chunk(jobs, Number(process.env.CFR_FETCH_CONCURRENCY || 8))) {
    if (Date.now() - startedAt > CFR_FETCH_DEADLINE_MS) break;
    const results = await Promise.all(jobBatch.map((job) => fetchCfrStation(job.station, job.type)));
    results.forEach((result, index) => {
      const job = jobBatch[index];
      attempted += 1;
      const stationIndex = measurements[job.type].findIndex((station) => station.id === job.station.id);
      if (stationIndex < 0 || !result) return;
      const value = Number(result.value);
      const station = measurements[job.type][stationIndex];
      filled += 1;
      measurements[job.type][stationIndex] = {
        ...station,
        value,
        trend: result.trend,
        updatedAt: result.updatedAt,
        warning: getWarningThreshold(job.type, value),
        danger: getDangerThreshold(job.type, value),
        history: job.type === "hydrometry" ? buildHydroHistory(value) : undefined,
        unavailable: false,
        provider: "CFR Toscana",
        real: true,
        extra: result.extra
      };
    });
  }

  return { measurements, filled, attempted };
}

async function fetchCfrMeasurements() {
  const measurements = buildEmptyMeasurements("CFR Toscana");
  let filled = 0;
  let attempted = 0;
  const startedAt = Date.now();
  const jobs = Object.entries(STATIONS_BY_TYPE).flatMap(([type, stations]) => {
    if (!CFR_TYPES[type]) return [];
    return stations.map((station, stationIndex) => ({ type, station, stationIndex }));
  });

  for (const jobBatch of chunk(jobs, Number(process.env.CFR_FETCH_CONCURRENCY || 12))) {
    if (Date.now() - startedAt > CFR_FETCH_DEADLINE_MS) break;
    const results = await Promise.all(jobBatch.map((job) => fetchCfrStation(job.station, job.type)));
    results.forEach((result, index) => {
      const job = jobBatch[index];
      attempted += 1;
      if (!result) return;
      const value = Number(result.value);
      const station = measurements[job.type][job.stationIndex];
      filled += 1;
      measurements[job.type][job.stationIndex] = {
        ...station,
        value,
        trend: result.trend,
        updatedAt: result.updatedAt,
        warning: getWarningThreshold(job.type, value),
        danger: getDangerThreshold(job.type, value),
        history: job.type === "hydrometry" ? buildHydroHistory(value) : undefined,
        unavailable: false,
        provider: "CFR Toscana",
        real: true,
        extra: result.extra
      };
    });
  }
  return { measurements, filled, attempted };
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
    const response = await fetch(OPEN_METEO_URL + "?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error("Open-Meteo HTTP " + response.status);
    return normalizeOpenMeteoResponses(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteoMeasurements(measurements, selection = null) {
  const candidateMap = new Map();
  const selectionKeys = selection ? new Set(selection.map((item) => item.type + ":" + item.station.id)) : null;
  OPEN_METEO_TYPES.forEach((type) => {
    (measurements[type] || []).forEach((station) => {
      if (selectionKeys && !selectionKeys.has(type + ":" + station.id)) return;
      if (station.value !== null && station.value !== undefined) return;
      if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return;
      if (!candidateMap.has(station.id)) candidateMap.set(station.id, { id: station.id, lat: station.lat, lng: station.lng });
    });
  });

  const byStationId = new Map();
  for (const stationBatch of chunk([...candidateMap.values()], 35)) {
    try {
      const responses = await fetchOpenMeteoBatch(stationBatch);
      responses.forEach((payload, index) => {
        const station = stationBatch[index];
        if (station) byStationId.set(station.id, payload);
      });
    } catch {
      // Open-Meteo resta un supporto: se non risponde, i dati ufficiali CFR non vengono alterati.
    }
  }
  return byStationId;
}

async function augmentWithOpenMeteo(measurements, selection = null) {
  const openMeteoByStationId = await fetchOpenMeteoMeasurements(measurements, selection);
  let filled = 0;
  const startedAt = Date.now();
  const nextMeasurements = Object.fromEntries(Object.entries(measurements).map(([type, stations]) => {
    if (!OPEN_METEO_TYPES.includes(type)) return [type, stations];
    return [type, stations.map((station) => {
      if (station.value !== null && station.value !== undefined) return station;
      if (Date.now() - startedAt > 12000) return station;
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
        warning: getWarningThreshold(type, Number(value)),
        danger: getDangerThreshold(type, Number(value))
      };
    })];
  }));
  return { measurements: nextMeasurements, filled };
}

function mergeMeasurements(baseMeasurements, realtimeMeasurements) {
  return Object.fromEntries(Object.entries(baseMeasurements).map(([type, stations]) => [
    type,
    stations.map((station) => {
      const realtime = realtimeMeasurements[type]?.find((candidate) => candidate.id === station.id);
      if (!realtime || realtime.value === null || realtime.value === undefined) return station;
      return { ...station, ...realtime };
    })
  ]));
}

function countPopulatedMeasurements(measurements) {
  return Object.values(measurements || {})
    .flat()
    .filter((station) => station.value !== null && station.value !== undefined).length;
}

function buildShellPayload() {
  return {
    source: "CFR Toscana",
    primarySource: "CFR Toscana",
    fallbackSource: null,
    fetchedAt: new Date().toISOString(),
    measurements: buildEmptyMeasurements("CFR Toscana"),
    cfr: {
      endpoint: "monitoraggio/dettaglio.php",
      attemptedStations: 0,
      populatedStations: 0,
      mode: "empty-cache"
    },
    openMeteoFallbackCount: 0,
    warning: null
  };
}

export function getObservationCacheHeaders({ realtime = false } = {}) {
  if (realtime) return { "Cache-Control": "no-store" };
  return {
    "Cache-Control": "s-maxage=" + DEFAULT_CACHE_MAX_AGE_SECONDS + ", stale-while-revalidate=1800"
  };
}

export async function getObservationData({ forceRefresh = false, selected = [], batch = null, type = null, batchSize = 24, realtime = false } = {}) {
  const selectedStations = parseSelectedStations(selected);
  const batchSelection = batch === null || batch === undefined ? [] : buildBatchSelection({ type, batch, batchSize });

  if (selectedStations.length) {
    const fetchedAt = new Date().toISOString();
    const cfrResult = await fetchCfrMeasurementsForSelection(selectedStations);
    const openMeteoResult = await augmentWithOpenMeteo(cfrResult.measurements, selectedStations);
    return {
      source: "CFR Toscana",
      primarySource: "CFR Toscana",
      fallbackSource: openMeteoResult.filled ? "Open-Meteo" : null,
      fetchedAt,
      measurements: openMeteoResult.measurements,
      cfr: {
        endpoint: "monitoraggio/dettaglio.php",
        attemptedStations: cfrResult.attempted,
        populatedStations: cfrResult.filled,
        mode: "realtime-selected",
        selectionSize: selectedStations.length,
        batch: null,
        type: null
      },
      openMeteoFallbackCount: openMeteoResult.filled,
      warning: cfrResult.filled || openMeteoResult.filled
        ? null
        : "CFR Toscana non ha restituito dati leggibili per le stazioni richieste."
    };
  }

  if (batchSelection.length) {
    const fetchedAt = new Date().toISOString();
    const cached = await readSharedCache();
    const basePayload = cached?.payload || buildShellPayload();
    const cfrResult = await fetchCfrMeasurementsForSelection(batchSelection);
    const openMeteoResult = await augmentWithOpenMeteo(cfrResult.measurements, batchSelection);
    const measurements = mergeMeasurements(basePayload.measurements, openMeteoResult.measurements);
    const cacheMode = await writeSharedCache({
      ...basePayload,
      source: "CFR Toscana",
      primarySource: "CFR Toscana",
      fallbackSource: openMeteoResult.filled ? "Open-Meteo" : basePayload.fallbackSource,
      fetchedAt,
      measurements,
      cfr: {
        endpoint: "monitoraggio/dettaglio.php",
        attemptedStations: (basePayload.cfr?.attemptedStations || 0) + cfrResult.attempted,
        populatedStations: countPopulatedMeasurements(measurements),
        lastBatchAttemptedStations: cfrResult.attempted,
        lastBatchPopulatedStations: cfrResult.filled,
        mode: "programmed-batch-cache",
        selectionSize: batchSelection.length,
        batch,
        type
      },
      openMeteoFallbackCount: (basePayload.openMeteoFallbackCount || 0) + openMeteoResult.filled,
      warning: cfrResult.filled || openMeteoResult.filled
        ? null
        : "Batch CFR eseguito senza nuovi dati leggibili."
    });

    const updated = getCache().payload;
    return {
      ...updated,
      cache: {
        hit: false,
        mode: cacheMode,
        persistent: cacheMode === "vercel-kv",
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000)
      }
    };
  }

  const cached = forceRefresh ? null : await readSharedCache();
  if (cached?.payload) {
    return {
      ...cached.payload,
      cache: {
        hit: true,
        mode: cached.mode,
        persistent: cached.mode === "vercel-kv",
        ttlSeconds: Math.round(CACHE_TTL_MS / 1000)
      }
    };
  }

  const payload = buildShellPayload();
  const cacheMode = await writeSharedCache(payload);
  return {
    ...payload,
    cfr: { ...payload.cfr, mode: "cdn-cache-shell" },
    cache: {
      hit: false,
      mode: cacheMode,
      persistent: cacheMode === "vercel-kv",
      ttlSeconds: Math.round(CACHE_TTL_MS / 1000)
    }
  };
}
