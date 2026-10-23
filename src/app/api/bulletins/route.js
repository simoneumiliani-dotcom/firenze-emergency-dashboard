import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getBulletinArchive, removeBulletinFromArchive, saveBulletinToArchive } from "@/lib/bulletinArchive";
import { DEFAULT_BULLETIN_PUBLISH_CODE } from "@/lib/bulletinPublishCode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// La scrittura dell'archivio decide lo stato di allerta mostrato in dashboard.
// Il codice condiviso vive in bulletinPublishCode.js, unica fonte sia per il server
// sia per il prompt della dashboard: blocca le scritture anonime da terzi.
const MAX_FILE_NAME = 160;
const MAX_LABEL = 200;
const MAX_TEXT = 4000;
const MAX_URL = 2048;
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM = 80;
const LEVELS = new Set(["Verde", "Giallo", "Arancione", "Rosso"]);

function reject(status, error) {
  return NextResponse.json({ error }, { status });
}

function readRequestToken(request) {
  const headerToken = request.headers.get("x-bulletin-token");
  if (headerToken && headerToken.trim()) return headerToken.trim();
  const authorization = request.headers.get("authorization");
  if (authorization && /^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, "").trim();
  return null;
}

function tokensMatch(provided, expected) {
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// Blocca il CSRF dal browser; i client non browser restano coperti dal token.
function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Stesso controllo per scrittura e rimozione: codice condiviso + stessa origine.
function checkWriteAccess(request) {
  if (!isSameOrigin(request)) {
    return reject(403, "Origine della richiesta non consentita.");
  }
  const providedToken = readRequestToken(request);
  if (!providedToken || !tokensMatch(providedToken, DEFAULT_BULLETIN_PUBLISH_CODE)) {
    return reject(401, "Codice di pubblicazione mancante o non valido.");
  }
  return null;
}

function asText(value, maxLength) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function asTextList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.slice(0, MAX_LIST_ITEM))
  )].slice(0, MAX_LIST_ITEMS);
}

function asIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asPdfUrl(value) {
  const text = asText(value, MAX_URL);
  if (!text) return null;
  // I data URL base64 non vengono salvati: gonfiano il record oltre i limiti del KV
  // e verrebbero riaperti in un iframe. Il PDF resta su IndexedDB nel dispositivo.
  return /^https:\/\//i.test(text) ? text : null;
}

function validateBulletinPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Payload non valido." };
  }

  const level = typeof payload.level === "string" ? payload.level.trim() : "";
  if (!LEVELS.has(level)) {
    return { error: "Livello non valido: usare Verde, Giallo, Arancione o Rosso." };
  }

  const validFrom = asIsoDate(payload.validFrom);
  const validTo = asIsoDate(payload.validTo);
  if (validFrom && validTo && new Date(validTo).getTime() < new Date(validFrom).getTime()) {
    return { error: "Intervallo di validita incoerente." };
  }

  return {
    value: {
      id: asText(payload.id, MAX_FILE_NAME + 40) || undefined,
      fileName: asText(payload.fileName, MAX_FILE_NAME) || "bollettino.pdf",
      level,
      matches: asTextList(payload.matches),
      reason: asText(payload.reason, MAX_TEXT),
      issue: asText(payload.issue, MAX_LABEL),
      issuedAt: asIsoDate(payload.issuedAt),
      validity: asText(payload.validity, MAX_LABEL),
      validFrom,
      validTo,
      textPreview: asText(payload.textPreview, MAX_TEXT),
      textTerms: asTextList(payload.textTerms),
      pdfUrl: asPdfUrl(payload.pdfUrl),
      uploadedAt: asIsoDate(payload.uploadedAt) || undefined
    }
  };
}

export async function GET() {
  const archive = await getBulletinArchive();
  return NextResponse.json(archive);
}

export async function POST(request) {
  const denied = checkWriteAccess(request);
  if (denied) return denied;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return reject(400, "Payload JSON non valido.");
  }

  const validated = validateBulletinPayload(payload);
  if (validated.error) return reject(400, validated.error);

  try {
    const archive = await saveBulletinToArchive(validated.value);
    return NextResponse.json(archive);
  } catch {
    return reject(500, "Impossibile salvare il bollettino nell'archivio.");
  }
}

// Ritira un bollettino pubblicato per errore: se era quello in corso, il livello
// torna a quello del bollettino valido precedente (o a nessun bollettino).
export async function DELETE(request) {
  const denied = checkWriteAccess(request);
  if (denied) return denied;

  const id = asText(new URL(request.url).searchParams.get("id"), MAX_FILE_NAME + 60);
  if (!id) return reject(400, "Identificativo del bollettino mancante.");

  try {
    const archive = await removeBulletinFromArchive(id);
    return NextResponse.json({ ...archive, removed: id });
  } catch {
    return reject(500, "Impossibile rimuovere il bollettino dall'archivio.");
  }
}
