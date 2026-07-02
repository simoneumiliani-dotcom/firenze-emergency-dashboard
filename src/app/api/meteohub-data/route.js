import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_BBOX = [6.6, 35.4, 18.5, 47.1];
const REQUEST_PREFIX = "firenze-emergency-dashboard";

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function getAccessKey() {
  return process.env.METEOHUB_ACCESS_KEY || process.env.METEOHUB_API_KEY || null;
}

function authCandidates() {
  const accessKey = getAccessKey();
  const username = process.env.METEOHUB_USERNAME;
  const password = process.env.METEOHUB_PASSWORD;
  const candidates = [];

  if (accessKey) {
    candidates.push({ authMode: "bearer-access-key", headers: { authorization: "Bearer " + accessKey } });
    candidates.push({ authMode: "basic-access-key-as-username", headers: { authorization: "Basic " + encodeBase64(accessKey + ":") } });
    if (username) {
      candidates.push({ authMode: "basic-username-access-key", headers: { authorization: "Basic " + encodeBase64(username + ":" + accessKey) } });
    }
    candidates.push({ authMode: "x-api-key", headers: { "x-api-key": accessKey } });
    candidates.push({ authMode: "x-access-key", headers: { "x-access-key": accessKey } });
  }

  if (username && password) {
    candidates.push({ authMode: "basic-credentials", headers: { authorization: "Basic " + encodeBase64(username + ":" + password) } });
  }

  return candidates.length ? candidates : [{ authMode: "anonymous", headers: {} }];
}

async function readPayload(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
}

async function meteoHubFetch(path, { method = "GET", body, candidate } = {}) {
  const response = await fetch(getBaseUrl() + path, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(candidate?.headers || {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await readPayload(response);
  if (!response.ok) throw new Error("MeteoHub " + method + " " + path + " HTTP " + response.status);
  return payload;
}

async function withAuth(operation) {
  let lastError = null;
  for (const candidate of authCandidates()) {
    try {
      return { authMode: candidate.authMode, payload: await operation(candidate) };
    } catch (error) {
      lastError = error;
      if (!/HTTP 401|HTTP 403/.test(error.message)) throw error;
    }
  }
  throw lastError || new Error("MeteoHub non autenticato");
}

function requestRows(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.requests || payload?.items || payload?.results || payload?.data || [];
}

function normalizeRequest(request) {
  return {
    id: request.id || request.uuid || request.request_id || request.task_id || null,
    name: request.request_name || request.name || request.title || "Richiesta MeteoHub",
    status: request.status || request.state || "n.d.",
    dataset: request.dataset || request.dataset_name || request.dataset_names || request.datasets || null,
    createdAt: request.created_at || request.creation_time || request.submitted_at || request.created || null,
    fileoutput: request.fileoutput || request.filename || request.output || request.download || request.url || null
  };
}

function buildExtractionPayload() {
  const now = new Date();
  const end = new Date(now.getTime() - 30 * 60 * 1000);
  const start = new Date(end.getTime() - 3 * 60 * 60 * 1000);
  const dataset = process.env.METEOHUB_DATASET_NAME || "radar_v2";
  const variables = (process.env.METEOHUB_VARIABLES || "reflectivity").split(",").map((item) => item.trim()).filter(Boolean);
  const bbox = (process.env.METEOHUB_BBOX || DEFAULT_BBOX.join(",")).split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
  const outputFormat = process.env.METEOHUB_OUTPUT_FORMAT || "netcdf";

  return {
    request_name: REQUEST_PREFIX + "-" + dataset + "-" + end.toISOString().slice(0, 13),
    dataset,
    variables,
    spatial_coverage: { type: "bbox", coordinates: bbox.length === 4 ? bbox : DEFAULT_BBOX },
    temporal_coverage: { start: start.toISOString(), end: end.toISOString() },
    output_format: outputFormat,
    dataset_names: [dataset],
    reftime: { from: start.toISOString(), to: end.toISOString() },
    filters: { product: variables.map((variable) => ({ value: variable })) }
  };
}

async function listRequests() {
  const result = await withAuth((candidate) => meteoHubFetch("/api/requests", { candidate }));
  return { authMode: result.authMode, requests: requestRows(result.payload).map(normalizeRequest) };
}

async function submitExtractionRequest() {
  const body = buildExtractionPayload();
  const result = await withAuth(async (candidate) => {
    try {
      return await meteoHubFetch("/api/data", { method: "POST", body, candidate });
    } catch (error) {
      if (!/HTTP 404|HTTP 405/.test(error.message)) throw error;
      return meteoHubFetch("/api/requests", { method: "POST", body, candidate });
    }
  });
  return { authMode: result.authMode, request: result.payload, payload: body };
}

export async function GET() {
  try {
    const { authMode, requests } = await listRequests();
    const dashboardRequests = requests.filter((request) => String(request.name || "").startsWith(REQUEST_PREFIX)).slice(0, 8);
    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: true,
      authenticated: true,
      authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      requests: dashboardRequests.length ? dashboardRequests : requests.slice(0, 8),
      note: "Flusso asincrono attivo: POST /api/data crea la richiesta, GET /api/requests monitora lo stato, /api/data/{filename} scarica l'output."
    });
  } catch (error) {
    return NextResponse.json({ source: "MeteoHub", baseUrl: getBaseUrl(), connected: false, authenticated: false, fetchedAt: new Date().toLocaleString("it-IT"), warning: error.message, requests: [] });
  }
}

export async function POST() {
  try {
    const submitted = await submitExtractionRequest();
    return NextResponse.json({ source: "MeteoHub", connected: true, authenticated: true, authMode: submitted.authMode, submittedAt: new Date().toLocaleString("it-IT"), request: submitted.request, payload: submitted.payload, note: "Richiesta asincrona inviata. Usa GET /api/meteohub-data per monitorare lo stato." }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ source: "MeteoHub", connected: false, authenticated: false, warning: error.message }, { status: 502 });
  }
}
