import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const DWD_ICON_ENDPOINT = "https://api.open-meteo.com/v1/dwd-icon";
const ECMWF_ENDPOINT = "https://api.open-meteo.com/v1/ecmwf";

const HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "dew_point_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "snow_depth",
  "weather_code",
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "visibility",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cape",
  "freezing_level_height"
].join(",");

const CURRENT = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m"
].join(",");

const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "rain_sum",
  "showers_sum",
  "snowfall_sum",
  "precipitation_hours",
  "precipitation_probability_max",
  "uv_index_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant"
].join(",");

const ECMWF_HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation",
  "rain",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "cape",
  "freezing_level_height"
].join(",");

const ECMWF_DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "rain_sum",
  "snowfall_sum",
  "precipitation_hours",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant"
].join(",");

const FORECAST_SOURCES = {
  best_match: {
    id: "best_match",
    label: "Open-Meteo best match",
    model: "best_match",
    endpoint: OPEN_METEO_ENDPOINT,
    maxDays: 7,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY
  },
  arpae: {
    id: "arpae_icon_2i",
    label: "ItaliaMeteo ARPAE ICON-2I",
    model: "italia_meteo_arpae_icon_2i",
    endpoint: OPEN_METEO_ENDPOINT,
    modelParam: "italia_meteo_arpae_icon_2i",
    maxDays: 3,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY
  },
  icon: {
    id: "dwd_icon",
    label: "DWD ICON",
    model: "dwd_icon_seamless",
    endpoint: DWD_ICON_ENDPOINT,
    maxDays: 7,
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY
  },
  ecmwf: {
    id: "ecmwf_ifs",
    label: "ECMWF IFS/AIFS",
    model: "ecmwf",
    endpoint: ECMWF_ENDPOINT,
    maxDays: 10,
    current: null,
    hourly: ECMWF_HOURLY,
    daily: ECMWF_DAILY
  }
};

function numberFromParam(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildForecastUrl(config, options) {
  const params = new URLSearchParams({
    latitude: String(options.lat),
    longitude: String(options.lng),
    hourly: config.hourly,
    daily: config.daily,
    timezone: "Europe/Rome",
    forecast_days: String(Math.min(options.days, config.maxDays || options.days)),
    wind_speed_unit: "kmh",
    precipitation_unit: "mm"
  });

  if (config.current) params.set("current", config.current);
  if (config.modelParam && config.endpoint.endsWith("/forecast")) params.set("models", config.modelParam);
  return config.endpoint + "?" + params.toString();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchForecastSource(config, options) {
  const url = buildForecastUrl(config, options);
  return {
    id: config.id,
    label: config.label,
    model: config.model,
    maxDays: config.maxDays,
    url,
    payload: await fetchJson(url)
  };
}

function getArray(payload, section, key) {
  return Array.isArray(payload?.[section]?.[key]) ? payload[section][key] : [];
}

function pick24HourSummaryFromHourly(hourly) {
  const rows = hourly.slice(0, 24);
  const sum = (items) => Number(items.reduce((total, value) => total + (Number(value) || 0), 0).toFixed(1));
  const max = (items) => Math.max(0, ...items.map((value) => Number(value) || 0));
  const validTemps = rows.map((row) => Number(row.temperature)).filter(Number.isFinite);
  const validApparentTemps = rows.map((row) => Number(row.apparentTemperature)).filter(Number.isFinite);
  const validHumidity = rows.map((row) => Number(row.humidity)).filter(Number.isFinite);
  const validVisibility = rows.map((row) => Number(row.visibility)).filter(Number.isFinite);
  const maxWindRow = rows
    .filter((row) => Number.isFinite(Number(row.windGust)))
    .sort((a, b) => Number(b.windGust) - Number(a.windGust))[0];

  return {
    rain24h: sum(rows.map((row) => row.precipitation)),
    showers24h: sum(rows.map((row) => row.showers)),
    snow24h: sum(rows.map((row) => row.snowfall)),
    maxSnowDepth: Number(max(rows.map((row) => row.snowDepth)).toFixed(1)),
    maxWindGust: Number(max(rows.map((row) => row.windGust)).toFixed(1)),
    maxWindDirection: maxWindRow?.windDirection ?? null,
    maxPrecipitationProbability: Number(max(rows.map((row) => row.precipitationProbability)).toFixed(0)),
    maxHumidity: validHumidity.length ? Number(Math.max(...validHumidity).toFixed(0)) : null,
    minVisibility: validVisibility.length ? Number((Math.min(...validVisibility) / 1000).toFixed(1)) : null,
    minTemperature: validTemps.length ? Number(Math.min(...validTemps).toFixed(1)) : null,
    maxTemperature: validTemps.length ? Number(Math.max(...validTemps).toFixed(1)) : null,
    minApparentTemperature: validApparentTemps.length ? Number(Math.min(...validApparentTemps).toFixed(1)) : null,
    maxApparentTemperature: validApparentTemps.length ? Number(Math.max(...validApparentTemps).toFixed(1)) : null
  };
}

function buildHazards(summary) {
  const hazards = [];
  if (summary.rain24h >= 50) hazards.push({ level: "Rosso", label: "Pioggia intensa 24h", detail: summary.rain24h + " mm previsti" });
  else if (summary.rain24h >= 30) hazards.push({ level: "Arancione", label: "Pioggia rilevante 24h", detail: summary.rain24h + " mm previsti" });
  else if (summary.rain24h >= 15) hazards.push({ level: "Giallo", label: "Pioggia significativa 24h", detail: summary.rain24h + " mm previsti" });

  if (summary.maxWindGust >= 90) hazards.push({ level: "Rosso", label: "Raffiche molto forti", detail: summary.maxWindGust + " km/h" });
  else if (summary.maxWindGust >= 70) hazards.push({ level: "Arancione", label: "Raffiche forti", detail: summary.maxWindGust + " km/h" });
  else if (summary.maxWindGust >= 50) hazards.push({ level: "Giallo", label: "Vento sostenuto", detail: summary.maxWindGust + " km/h" });

  if (summary.snow24h >= 10) hazards.push({ level: "Giallo", label: "Neve prevista", detail: summary.snow24h + " cm stimati" });
  return hazards;
}

function normalizeSource(source) {
  const payload = source.payload;
  const hourlyTimes = getArray(payload, "hourly", "time");
  const hourly = hourlyTimes.map((time, index) => ({
    time,
    hour: String(time).slice(11, 16),
    temperature: getArray(payload, "hourly", "temperature_2m")[index] ?? null,
    apparentTemperature: getArray(payload, "hourly", "apparent_temperature")[index] ?? null,
    humidity: getArray(payload, "hourly", "relative_humidity_2m")[index] ?? null,
    dewPoint: getArray(payload, "hourly", "dew_point_2m")[index] ?? null,
    precipitationProbability: getArray(payload, "hourly", "precipitation_probability")[index] ?? null,
    precipitation: getArray(payload, "hourly", "precipitation")[index] ?? null,
    rain: getArray(payload, "hourly", "rain")[index] ?? null,
    showers: getArray(payload, "hourly", "showers")[index] ?? null,
    snowfall: getArray(payload, "hourly", "snowfall")[index] ?? null,
    snowDepth: getArray(payload, "hourly", "snow_depth")[index] ?? null,
    weatherCode: getArray(payload, "hourly", "weather_code")[index] ?? null,
    cloudCover: getArray(payload, "hourly", "cloud_cover")[index] ?? null,
    cloudCoverLow: getArray(payload, "hourly", "cloud_cover_low")[index] ?? null,
    cloudCoverMid: getArray(payload, "hourly", "cloud_cover_mid")[index] ?? null,
    cloudCoverHigh: getArray(payload, "hourly", "cloud_cover_high")[index] ?? null,
    visibility: getArray(payload, "hourly", "visibility")[index] ?? null,
    windSpeed: getArray(payload, "hourly", "wind_speed_10m")[index] ?? null,
    windGust: getArray(payload, "hourly", "wind_gusts_10m")[index] ?? null,
    windDirection: getArray(payload, "hourly", "wind_direction_10m")[index] ?? null,
    cape: getArray(payload, "hourly", "cape")[index] ?? null,
    freezingLevel: getArray(payload, "hourly", "freezing_level_height")[index] ?? null
  }));

  const daily = getArray(payload, "daily", "time").map((day, index) => ({
    day,
    weatherCode: getArray(payload, "daily", "weather_code")[index] ?? null,
    temperatureMax: getArray(payload, "daily", "temperature_2m_max")[index] ?? null,
    temperatureMin: getArray(payload, "daily", "temperature_2m_min")[index] ?? null,
    precipitation: getArray(payload, "daily", "precipitation_sum")[index] ?? null,
    rain: getArray(payload, "daily", "rain_sum")[index] ?? null,
    snowfall: getArray(payload, "daily", "snowfall_sum")[index] ?? null,
    precipitationHours: getArray(payload, "daily", "precipitation_hours")[index] ?? null,
    precipitationProbability: getArray(payload, "daily", "precipitation_probability_max")[index] ?? null,
    uvIndexMax: getArray(payload, "daily", "uv_index_max")[index] ?? null,
    windSpeedMax: getArray(payload, "daily", "wind_speed_10m_max")[index] ?? null,
    windGustMax: getArray(payload, "daily", "wind_gusts_10m_max")[index] ?? null,
    windDirection: getArray(payload, "daily", "wind_direction_10m_dominant")[index] ?? null
  }));

  const summary24h = pick24HourSummaryFromHourly(hourly);
  return {
    id: source.id,
    label: source.label,
    model: source.model,
    maxDays: source.maxDays,
    url: source.url,
    generationTimeMs: payload.generationtime_ms,
    latitude: payload.latitude,
    longitude: payload.longitude,
    elevation: payload.elevation,
    timezone: payload.timezone,
    current: payload.current || null,
    currentUnits: payload.current_units || {},
    hourlyUnits: payload.hourly_units || {},
    dailyUnits: payload.daily_units || {},
    summary24h,
    hazards: buildHazards(summary24h),
    hourly,
    daily
  };
}

function mergeRecommendedSources(normalizedSources) {
  const arpae = normalizedSources.find((source) => source.id === "arpae_icon_2i");
  const icon = normalizedSources.find((source) => source.id === "dwd_icon");
  const ecmwf = normalizedSources.find((source) => source.id === "ecmwf_ifs");
  const best = normalizedSources.find((source) => source.id === "best_match");
  const fallback = icon || ecmwf || best || arpae;
  if (!arpae && !fallback) return null;
  if (!arpae) return { ...fallback, primary: true };

  const arpaeDays = new Set(arpae.daily.map((day) => day.day));
  const sourcesByPriority = [arpae, icon, ecmwf, best].filter(Boolean);
  const allHourlyTimes = [...new Set(sourcesByPriority.flatMap((source) => source.hourly.map((row) => row.time)))].sort();
  const allDailyDays = [...new Set(sourcesByPriority.flatMap((source) => source.daily.map((row) => row.day)))].sort();

  function pickSourceForDay(day) {
    if (arpaeDays.has(day)) return arpae;
    return fallback;
  }

  const hourly = allHourlyTimes.map((time) => {
    const day = String(time).slice(0, 10);
    const preferred = pickSourceForDay(day);
    return preferred.hourly.find((row) => row.time === time)
      || sourcesByPriority.map((source) => source.hourly.find((row) => row.time === time)).find(Boolean);
  }).filter(Boolean);

  const daily = allDailyDays.map((day) => {
    const preferred = pickSourceForDay(day);
    return preferred.daily.find((row) => row.day === day)
      || sourcesByPriority.map((source) => source.daily.find((row) => row.day === day)).find(Boolean);
  }).filter(Boolean);

  const summary24h = pick24HourSummaryFromHourly(hourly);
  return {
    id: "recommended",
    label: "Consigliato Firenze",
    model: arpae && fallback?.id !== arpae.id ? "ARPAE ICON-2I + " + fallback.label : arpae.label,
    primary: true,
    generationTimeMs: arpae.generationTimeMs,
    latitude: arpae.latitude,
    longitude: arpae.longitude,
    elevation: arpae.elevation,
    timezone: arpae.timezone,
    current: arpae.current || fallback?.current || null,
    currentUnits: arpae.currentUnits || fallback?.currentUnits || {},
    hourlyUnits: arpae.hourlyUnits || fallback?.hourlyUnits || {},
    dailyUnits: arpae.dailyUnits || fallback?.dailyUnits || {},
    summary24h,
    hazards: buildHazards(summary24h),
    hourly,
    daily
  };
}

async function tryFetch(config, options, errors) {
  try {
    return normalizeSource(await fetchForecastSource(config, options));
  } catch (error) {
    errors.push({ source: config.label, message: error.message });
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 43.7696);
  const lng = numberFromParam(searchParams.get("lng"), 11.2558);
  const days = Math.max(1, Math.min(7, numberFromParam(searchParams.get("days"), 3)));
  const profile = String(searchParams.get("profile") || "recommended");
  const sources = [];
  const errors = [];

  if (profile === "recommended") {
    const attempts = await Promise.all([
      tryFetch(FORECAST_SOURCES.arpae, { lat, lng, days }, errors),
      tryFetch(FORECAST_SOURCES.icon, { lat, lng, days }, errors),
      tryFetch(FORECAST_SOURCES.ecmwf, { lat, lng, days }, errors),
      tryFetch(FORECAST_SOURCES.best_match, { lat, lng, days }, errors)
    ]);
    const available = attempts.filter(Boolean);
    const recommended = mergeRecommendedSources(available);
    if (recommended) sources.push(recommended);
    sources.push(...available);
  } else {
    const config = FORECAST_SOURCES[profile] || FORECAST_SOURCES.best_match;
    const source = await tryFetch(config, { lat, lng, days }, errors);
    if (source) sources.push({ ...source, primary: true });
  }

  return NextResponse.json({
    source: "Open-Meteo",
    fetchedAt: new Date().toISOString(),
    query: { lat, lng, days, profile },
    sources,
    errors,
    warning: sources.length ? null : "Previsioni non disponibili in questo momento."
  }, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" }
  });
}
