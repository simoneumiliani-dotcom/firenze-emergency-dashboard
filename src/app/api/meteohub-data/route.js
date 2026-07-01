import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLE_OBSERVATION_QUERY = "reftime: >=2026-01-01 00:00,<=2099-12-31 23:59;product:B12101;license:CCBY_COMPLIANT;timerange:254,0,0;level:103,2000,0,0";

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
}

function getAccessKey() {
  return process.env.METEOHUB_ACCESS_KEY || process.env.METEOHUB_API_KEY || null;
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

async function login() {
  if (getAccessKey()) {
    return { authenticated: true, authMode: "access-key", token: getAccessKey(), payloadKeys: [] };
  }

  if (!hasCredentials()) {
    return { authenticated: false, authMode: "anonymous", warning: "Credenziali MeteoHub non configurate." };
  }

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
    return { authenticated: false, authMode: "login-failed", warning: `Login MeteoHub HTTP ${response.status}` };
  }

  const token = findToken(payload);
  const cookie = toCookieHeader(readSetCookieHeaders(response.headers));

  return {
    token,
    cookie,
    authenticated: Boolean(token || cookie),
    authMode: token ? "bearer" : cookie ? "cookie" : "login-ok-no-token",
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : []
  };
}

function buildHeaders(session = {}) {
  const headers = { "accept": "application/json,text/plain,*/*" };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (session.cookie) headers.cookie = session.cookie;
  return headers;
}

async function checkObservations(session) {
  const params = new URLSearchParams({
    q: SAMPLE_OBSERVATION_QUERY,
    reliabilityCheck: "true",
    last: "true",
    ts: String(Date.now())
  });
  const response = await fetch(`${getBaseUrl()}/api/observations?${params.toString()}`, {
    cache: "no-store",
    headers: buildHeaders(session)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Osservazioni MeteoHub HTTP ${response.status}`);
  }

  let count = null;
  try {
    const payload = text ? JSON.parse(text) : null;
    count = Array.isArray(payload) ? payload.length : Array.isArray(payload?.data) ? payload.data.length : null;
  } catch {
    count = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
  }

  return { ok: true, count };
}

export async function GET() {
  const session = await login().catch((error) => ({ authenticated: false, authMode: "login-error", warning: error.message }));

  try {
    const observations = await checkObservations(session);

    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: true,
      authenticated: session.authenticated,
      authMode: session.authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      requests: [],
      observations,
      note: "Endpoint realtime /api/observations raggiungibile. /api/requests e riservato alle estrazioni asincrone e non blocca la dashboard."
    });
  } catch (error) {
    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: false,
      authenticated: session.authenticated,
      authMode: session.authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: session.warning ? `${session.warning}; ${error.message}` : error.message,
      requests: []
    });
  }
}
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SAMPLE_OBSERVATION_QUERY = "reftime: >=2026-01-01 00:00,<=2099-12-31 23:59;product:B12101;license:CCBY_COMPLIANT;timerange:254,0,0;level:103,2000,0,0";

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
}

function getAccessKey() {
  return process.env.METEOHUB_ACCESS_KEY || process.env.METEOHUB_API_KEY || null;
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

async function login() {
  if (getAccessKey()) {
    return { authenticated: true, authMode: "access-key", token: getAccessKey(), payloadKeys: [] };
  }

  if (!hasCredentials()) {
    return { authenticated: false, authMode: "anonymous", warning: "Credenziali MeteoHub non configurate." };
  }

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
    return { authenticated: false, authMode: "login-failed", warning: `Login MeteoHub HTTP ${response.status}` };
  }

  const token = findToken(payload);
  const cookie = toCookieHeader(readSetCookieHeaders(response.headers));

  return {
    token,
    cookie,
    authenticated: Boolean(token || cookie),
    authMode: token ? "bearer" : cookie ? "cookie" : "login-ok-no-token",
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : []
  };
}

function buildHeaders(session = {}) {
  const headers = { "accept": "application/json,text/plain,*/*" };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (session.cookie) headers.cookie = session.cookie;
  return headers;
}

async function checkObservations(session) {
  const params = new URLSearchParams({
    q: SAMPLE_OBSERVATION_QUERY,
    reliabilityCheck: "true",
    last: "true",
    ts: String(Date.now())
  });
  const response = await fetch(`${getBaseUrl()}/api/observations?${params.toString()}`, {
    cache: "no-store",
    headers: buildHeaders(session)
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Osservazioni MeteoHub HTTP ${response.status}`);
  }

  let count = null;
  try {
    const payload = text ? JSON.parse(text) : null;
    count = Array.isArray(payload) ? payload.length : Array.isArray(payload?.data) ? payload.data.length : null;
  } catch {
    count = text ? text.split(/\r?\n/).filter(Boolean).length : 0;
  }

  return { ok: true, count };
}

export async function GET() {
  const session = await login().catch((error) => ({ authenticated: false, authMode: "login-error", warning: error.message }));

  try {
    const observations = await checkObservations(session);

    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: true,
      authenticated: session.authenticated,
      authMode: session.authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      requests: [],
      observations,
      note: "Endpoint realtime /api/observations raggiungibile. /api/requests e riservato alle estrazioni asincrone e non blocca la dashboard."
    });
  } catch (error) {
    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: false,
      authenticated: session.authenticated,
      authMode: session.authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: session.warning ? `${session.warning}; ${error.message}` : error.message,
      requests: []
    });
  }
}
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
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

async function login() {
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
    authenticated: true,
    authMode: token ? "bearer" : cookie ? "cookie" : "login-ok-no-session",
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 8) : []
  };
}

function buildHeaders(session = {}) {
  const headers = { "accept": "application/json,text/plain,*/*" };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (session.cookie) headers.cookie = session.cookie;
  return headers;
}

async function fetchRequests(session) {
  const response = await fetch(`${getBaseUrl()}/api/requests`, {
    cache: "no-store",
    headers: buildHeaders(session)
  });

  if (!response.ok) {
    throw new Error(`Richieste MeteoHub HTTP ${response.status}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.requests || payload.items || payload.results || [];

  return rows.slice(0, 8).map((request) => ({
    id: request.id || request.request_id || request.task_id || null,
    name: request.request_name || request.name || request.title || "Richiesta MeteoHub",
    status: request.status || request.state || "n.d.",
    dataset: request.dataset || request.dataset_name || request.dataset_names || null,
    createdAt: request.created_at || request.creation_time || request.submitted_at || null,
    fileoutput: request.fileoutput || request.filename || null
  }));
}

export async function GET() {
  if (!hasCredentials()) {
    return NextResponse.json({
      source: "MeteoHub",
      connected: false,
      authenticated: false,
      warning: "Credenziali MeteoHub non configurate in .env.local.",
      requests: []
    });
  }

  try {
    const session = await login();
    const requests = await fetchRequests(session);

    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: true,
      authenticated: true,
      authMode: session.authMode,
      fetchedAt: new Date().toLocaleString("it-IT"),
      requests,
      note: session.authMode === "login-ok-no-session"
        ? "Login accettato da MeteoHub; nessun token/cookie esposto, endpoint richieste accessibile senza bearer esplicito."
        : "Connessione autenticata riuscita."
    });
  } catch (error) {
    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: false,
      authenticated: false,
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: error.cause?.code
        ? `${error.message} (${error.cause.code})`
        : error.message,
      requests: []
    });
  }
}
