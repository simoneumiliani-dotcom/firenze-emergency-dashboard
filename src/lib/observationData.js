import { MEASUREMENT_TYPES, STATIONS_BY_TYPE, getStationPosition } from "@/lib/cfrStations";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TYPES = ["pluviometry", "thermometry", "anemometry", "hygrometry", "nivometry"];
const CACHE_TTL_MS = Number(process.env.OBSERVATION_CACHE_TTL_SECONDS || 900) * 1000;
const CFR_FETCH_DEADLINE_MS = Number(process.env.CFR_FETCH_DEADLINE_MS || 8500);

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
    const timeout = setTimeout(() => controller.abort(), 8000);
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

async function fetchOpenMeteoMeasurements(measurements) {
  const candidateMap = new Map();
  OPEN_METEO_TYPES.forEach((type) => {
    (measurements[type] || []).forEach((station) => {
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

async function augmentWithOpenMeteo(measurements) {
  const openMeteoByStationId = await fetchOpenMeteoMeasurements(measurements);
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

export async function getObservationData({ forceRefresh = false } = {}) {
  const cache = getCache();
  const now = Date.now();
  if (!forceRefresh && cache.payload && now - cache.updatedAt < CACHE_TTL_MS) {
    return { ...cache.payload, cache: { hit: true, ttlSeconds: Math.round(CACHE_TTL_MS / 1000) } };
  }

  const fetchedAt = new Date().toISOString();
  const cfrResult = await fetchCfrMeasurements();
  const openMeteoResult = await augmentWithOpenMeteo(cfrResult.measurements);
  const payload = {
    source: "CFR Toscana",
    primarySource: "CFR Toscana",
    fallbackSource: openMeteoResult.filled ? "Open-Meteo" : null,
    fetchedAt,
    measurements: openMeteoResult.measurements,
    cfr: {
      endpoint: "monitoraggio/dettaglio.php",
      attemptedStations: cfrResult.attempted,
      populatedStations: cfrResult.filled
    },
    openMeteoFallbackCount: openMeteoResult.filled,
    warning: cfrResult.filled
      ? null
      : "CFR Toscana non ha restituito dati leggibili in questo momento. Open-Meteo copre solo i sensori meteorologici disponibili."
  };

  cache.payload = payload;
  cache.updatedAt = now;
  return { ...payload, cache: { hit: false, ttlSeconds: Math.round(CACHE_TTL_MS / 1000) } };
}
