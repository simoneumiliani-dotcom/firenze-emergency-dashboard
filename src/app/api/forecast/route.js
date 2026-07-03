import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ITALIA_METEO_ENDPOINTS = [
  "https://api.open-meteo.com/v1/italia-meteo-arpae",
  "https://api.open-meteo.com/v1/forecast"
];

const HOURLY = [
  "temperature_2m",
  "relative_humidity_2m",
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "snow_depth",
  "weather_code",
  "cloud_cover",
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
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant"
].join(",");

function numberFromParam(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildForecastUrl(endpoint, options) {
  const params = new URLSearchParams({
    latitude: String(options.lat),
    longitude: String(options.lng),
    current: CURRENT,
    hourly: HOURLY,
    daily: DAILY,
    timezone: "Europe/Rome",
    forecast_days: String(options.days),
    wind_speed_unit: "kmh",
    precipitation_unit: "mm"
  });

  if (options.model && endpoint.endsWith("/forecast")) params.set("models", options.model);
  return endpoint + "?" + params.toString();
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

async function fetchOpenMeteo(options) {
  const url = buildForecastUrl(OPEN_METEO_ENDPOINT, options);
  return {
    id: "open-meteo",
    label: "Open-Meteo best match",
    model: "best_match",
    url,
    payload: await fetchJson(url)
  };
}

async function fetchItaliaMeteo(options) {
  const errors = [];
  const cappedDays = Math.min(options.days, 3);
  for (const endpoint of ITALIA_METEO_ENDPOINTS) {
    const attempts = endpoint.endsWith("/forecast")
      ? ["italia_meteo_arpae_icon_2i", "icon_2i"]
      : [null];

    for (const model of attempts) {
      const url = buildForecastUrl(endpoint, { ...options, days: cappedDays, model });
      try {
        return {
          id: "italia-meteo",
          label: "ItaliaMeteo ICON-2I",
          model: model || "icon_2i",
          url,
          payload: await fetchJson(url)
        };
      } catch (error) {
        errors.push((model || endpoint) + ": " + error.message);
      }
    }
  }
  throw new Error(errors.join("; "));
}

function getArray(payload, section, key) {
  return Array.isArray(payload?.[section]?.[key]) ? payload[section][key] : [];
}

function pick24HourSummary(payload) {
  const precipitation = getArray(payload, "hourly", "precipitation").slice(0, 24);
  const wind = getArray(payload, "hourly", "wind_gusts_10m").slice(0, 24);
  const snow = getArray(payload, "hourly", "snowfall").slice(0, 24);
  const probability = getArray(payload, "hourly", "precipitation_probability").slice(0, 24);
  const temperature = getArray(payload, "hourly", "temperature_2m").slice(0, 24);

  const sum = (items) => Number(items.reduce((total, value) => total + (Number(value) || 0), 0).toFixed(1));
  const max = (items) => Math.max(...items.map((value) => Number(value) || 0));
  const validTemps = temperature.map(Number).filter(Number.isFinite);

  return {
    rain24h: sum(precipitation),
    snow24h: sum(snow),
    maxWindGust: Number(max(wind).toFixed(1)),
    maxPrecipitationProbability: Number(max(probability).toFixed(0)),
    minTemperature: validTemps.length ? Number(Math.min(...validTemps).toFixed(1)) : null,
    maxTemperature: validTemps.length ? Number(Math.max(...validTemps).toFixed(1)) : null
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
    humidity: getArray(payload, "hourly", "relative_humidity_2m")[index] ?? null,
    precipitationProbability: getArray(payload, "hourly", "precipitation_probability")[index] ?? null,
    precipitation: getArray(payload, "hourly", "precipitation")[index] ?? null,
    rain: getArray(payload, "hourly", "rain")[index] ?? null,
    snowfall: getArray(payload, "hourly", "snowfall")[index] ?? null,
    snowDepth: getArray(payload, "hourly", "snow_depth")[index] ?? null,
    weatherCode: getArray(payload, "hourly", "weather_code")[index] ?? null,
    cloudCover: getArray(payload, "hourly", "cloud_cover")[index] ?? null,
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
    windSpeedMax: getArray(payload, "daily", "wind_speed_10m_max")[index] ?? null,
    windGustMax: getArray(payload, "daily", "wind_gusts_10m_max")[index] ?? null,
    windDirection: getArray(payload, "daily", "wind_direction_10m_dominant")[index] ?? null
  }));

  const summary24h = pick24HourSummary(payload);
  return {
    id: source.id,
    label: source.label,
    model: source.model,
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 43.7696);
  const lng = numberFromParam(searchParams.get("lng"), 11.2558);
  const days = Math.max(1, Math.min(7, numberFromParam(searchParams.get("days"), 3)));
  const includeItaliaMeteo = searchParams.get("italia") !== "0";

  const sources = [];
  const errors = [];

  try {
    sources.push(normalizeSource(await fetchOpenMeteo({ lat, lng, days })));
  } catch (error) {
    errors.push({ source: "Open-Meteo", message: error.message });
  }

  if (includeItaliaMeteo) {
    try {
      sources.push(normalizeSource(await fetchItaliaMeteo({ lat, lng, days })));
    } catch (error) {
      errors.push({ source: "ItaliaMeteo ICON-2I", message: error.message });
    }
  }

  return NextResponse.json({
    source: "Open-Meteo + ItaliaMeteo ICON-2I",
    fetchedAt: new Date().toISOString(),
    query: { lat, lng, days },
    sources,
    errors,
    warning: sources.length ? null : "Previsioni non disponibili in questo momento."
  }, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=900" }
  });
}
