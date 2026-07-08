import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

const MINUTELY_15 = [
  "precipitation",
  "rain",
  "snowfall",
  "weather_code",
  "cape",
  "lightning_potential_index"
].join(",");

const MINUTELY_15_FALLBACK = [
  "precipitation",
  "rain",
  "snowfall",
  "weather_code"
].join(",");

function numberFromParam(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasMeteoHubCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
}

function readSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
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

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const { headers: optionHeaders = {}, ...restOptions } = options;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      ...restOptions,
      headers: { accept: "application/json,text/plain,*/*", ...optionHeaders }
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text.slice(0, 300) };
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { payload, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteoRadar(lat, lng) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    minutely_15: MINUTELY_15,
    current: "precipitation,rain,showers,snowfall,weather_code,cloud_cover",
    timezone: "Europe/Rome",
    forecast_minutely_15: "24",
    past_minutely_15: "4",
    precipitation_unit: "mm"
  });

  let url = OPEN_METEO_ENDPOINT + "?" + params.toString();
  let payload;
  try {
    ({ payload } = await fetchJson(url));
  } catch {
    params.set("minutely_15", MINUTELY_15_FALLBACK);
    url = OPEN_METEO_ENDPOINT + "?" + params.toString();
    ({ payload } = await fetchJson(url));
  }
  const times = Array.isArray(payload?.minutely_15?.time) ? payload.minutely_15.time : [];
  const rows = times.map((time, index) => ({
    time,
    hour: String(time).slice(11, 16),
    precipitation: payload.minutely_15?.precipitation?.[index] ?? null,
    rain: payload.minutely_15?.rain?.[index] ?? null,
    snowfall: payload.minutely_15?.snowfall?.[index] ?? null,
    weatherCode: payload.minutely_15?.weather_code?.[index] ?? null,
    cape: payload.minutely_15?.cape?.[index] ?? null,
    lightningPotential: payload.minutely_15?.lightning_potential_index?.[index] ?? null
  }));

  const futureRows = rows.filter((row) => new Date(row.time).getTime() >= Date.now() - 20 * 60 * 1000);
  const maxPrecipitation = Math.max(0, ...futureRows.map((row) => Number(row.precipitation) || 0));
  const totalNext3h = Number(futureRows.slice(0, 12).reduce((sum, row) => sum + (Number(row.precipitation) || 0), 0).toFixed(1));
  const maxLightningPotential = Math.max(0, ...futureRows.map((row) => Number(row.lightningPotential) || 0));

  return {
    id: "open-meteo",
    label: "Open-Meteo nowcasting 15 min",
    sourceUrl: url,
    available: rows.length > 0,
    updatedAt: new Date().toISOString(),
    current: payload.current || null,
    units: payload.minutely_15_units || {},
    summary: {
      maxPrecipitation,
      totalNext3h,
      maxLightningPotential
    },
    rows
  };
}

async function fetchMeteoHubRadar() {
  if (!hasMeteoHubCredentials()) {
    return {
      id: "meteohub",
      label: "MeteoHub radar",
      available: false,
      configured: false,
      sourceUrl: getBaseUrl(),
      note: "Credenziali MeteoHub non configurate su Vercel."
    };
  }

  const login = await fetchJson(`${getBaseUrl()}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: process.env.METEOHUB_USERNAME,
      password: process.env.METEOHUB_PASSWORD
    })
  });

  const token = findToken(login.payload);
  const cookie = toCookieHeader(readSetCookieHeaders(login.headers));
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;

  const requests = await fetchJson(`${getBaseUrl()}/api/requests`, { headers });
  const rows = Array.isArray(requests.payload)
    ? requests.payload
    : requests.payload.requests || requests.payload.items || requests.payload.results || [];

  const radarRequests = rows
    .filter((item) => JSON.stringify(item).toLowerCase().includes("radar"))
    .slice(0, 5)
    .map((item) => ({
      id: item.id || item.request_id || item.task_id || null,
      name: item.name || item.title || item.request_name || item.dataset || "Richiesta radar MeteoHub",
      status: item.status || item.state || "n.d.",
      dataset: item.dataset || item.dataset_name || item.dataset_names || null,
      createdAt: item.created_at || item.creation_time || item.submitted_at || null
    }));

  return {
    id: "meteohub",
    label: "MeteoHub radar",
    available: true,
    configured: true,
    sourceUrl: getBaseUrl(),
    updatedAt: new Date().toISOString(),
    authMode: token ? "bearer" : cookie ? "cookie" : "login",
    requests: radarRequests,
    note: radarRequests.length
      ? "Richieste radar trovate su MeteoHub."
      : "MeteoHub raggiunto; nessuna richiesta radar recente trovata nell'account."
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = numberFromParam(searchParams.get("lat"), 43.7696);
  const lng = numberFromParam(searchParams.get("lng"), 11.2558);
  const errors = [];
  let openMeteo = null;
  let meteoHub = null;

  try {
    openMeteo = await fetchOpenMeteoRadar(lat, lng);
  } catch (error) {
    errors.push({ source: "Open-Meteo", message: error.message });
  }

  try {
    meteoHub = await fetchMeteoHubRadar();
  } catch (error) {
    meteoHub = {
      id: "meteohub",
      label: "MeteoHub radar",
      available: false,
      configured: hasMeteoHubCredentials(),
      sourceUrl: getBaseUrl(),
      note: error.message
    };
    errors.push({ source: "MeteoHub", message: error.message });
  }

  return NextResponse.json({
    source: "Open-Meteo + MeteoHub",
    fetchedAt: new Date().toISOString(),
    query: { lat, lng },
    openMeteo,
    meteoHub,
    errors
  }, {
    headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" }
  });
}
