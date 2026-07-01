import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getBaseUrl() {
  return (process.env.METEOHUB_API_BASE || "https://meteohub.agenziaitaliameteo.it").replace(/\/$/, "");
}

function hasCredentials() {
  return Boolean(process.env.METEOHUB_USERNAME && process.env.METEOHUB_PASSWORD);
}

async function login() {
  const response = await fetch(`${getBaseUrl()}/auth/login`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "accept": "application/json"
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
    payload = { raw: rawBody.slice(0, 300) };
  }

  if (!response.ok) {
    throw new Error(`Login MeteoHub HTTP ${response.status}`);
  }

  const token = payload.access_token || payload.token || payload.accessToken || payload.jwt;
  if (!token) {
    throw new Error("Login MeteoHub riuscito ma token non trovato nella risposta.");
  }

  return token;
}

async function fetchRequests(token) {
  const response = await fetch(`${getBaseUrl()}/api/requests`, {
    cache: "no-store",
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`
    }
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
      warning: "Credenziali MeteoHub non configurate in .env.local.",
      requests: []
    });
  }

  try {
    const token = await login();
    const requests = await fetchRequests(token);

    return NextResponse.json({
      source: "MeteoHub",
      baseUrl: getBaseUrl(),
      connected: true,
      authenticated: true,
      fetchedAt: new Date().toLocaleString("it-IT"),
      requests,
      note: "Connessione autenticata riuscita. Le estrazioni dati MeteoHub sono asincrone e vanno create con /api/data."
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
