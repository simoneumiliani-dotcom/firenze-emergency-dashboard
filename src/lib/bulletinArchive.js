const BULLETIN_ARCHIVE_KEY = process.env.BULLETIN_ARCHIVE_KEY || "firenze:bulletins:v1";
export const BULLETIN_ARCHIVE_LIMIT = Number(process.env.BULLETIN_ARCHIVE_LIMIT || 5);

function hasPersistentStore() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getKvUrl(path) {
  return process.env.KV_REST_API_URL.replace(/\/+$/, "") + path;
}

// Il PDF non sta nel record d'archivio: da solo supera il limite di valore del
// KV e gonfierebbe ogni risposta GET. Viaggia su chiavi separate, un blocco per
// richiesta, e viene riassemblato da /api/bulletins/pdf per ogni dispositivo.
const PDF_KEY_PREFIX = process.env.BULLETIN_PDF_KEY_PREFIX || "firenze:bulletin-pdf:v1";
const PDF_CHUNK_SIZE = 700000;

function pdfChunkKey(id, index) {
  return PDF_KEY_PREFIX + ":" + id + ":" + index;
}

function pdfBase64FromDataUrl(url) {
  if (typeof url !== "string") return null;
  const match = url.match(/^data:application\/pdf[^,]*;base64,([A-Za-z0-9+/=]+)$/i);
  return match ? match[1] : null;
}

async function readKvValue(key) {
  try {
    const response = await fetch(getKvUrl("/get/" + encodeURIComponent(key)), {
      headers: { Authorization: "Bearer " + process.env.KV_REST_API_TOKEN },
      cache: "no-store"
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body?.result ?? null;
  } catch {
    return null;
  }
}

async function writeKvCommands(commands) {
  try {
    const response = await fetch(getKvUrl("/pipeline"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.KV_REST_API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(commands)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function writeSharedPdf(id, base64) {
  if (!hasPersistentStore() || !id || !base64) return 0;

  let chunks = 0;
  for (let offset = 0; offset < base64.length; offset += PDF_CHUNK_SIZE) {
    const saved = await writeKvCommands([
      ["SET", pdfChunkKey(id, chunks), base64.slice(offset, offset + PDF_CHUNK_SIZE)]
    ]);
    if (!saved) return 0;
    chunks += 1;
  }
  return chunks;
}

async function deleteSharedPdf(id, chunkCount) {
  if (!hasPersistentStore() || !id || !Number.isFinite(chunkCount) || chunkCount <= 0) return;
  for (let index = 0; index < chunkCount; index += 1) {
    await writeKvCommands([["DEL", pdfChunkKey(id, index)]]);
  }
}

// Base64 del PDF condiviso di un bollettino, ricomposto dai blocchi nel KV.
// Restituisce null se il file non è disponibile (archivio vecchio o KV assente).
export async function readSharedBulletinPdf(id, chunkCount) {
  if (!hasPersistentStore() || !id || !Number.isFinite(chunkCount) || chunkCount <= 0) return null;

  let base64 = "";
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = await readKvValue(pdfChunkKey(id, index));
    if (typeof chunk !== "string" || !chunk) return null;
    base64 += chunk;
  }
  return base64;
}


function getReferenceDate(bulletin) {
  const value = bulletin?.validTo || bulletin?.uploadedAt || bulletin?.parsedAt;
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function isBulletinCurrent(bulletin, now = new Date()) {
  if (!bulletin?.validTo) return false;
  const validTo = new Date(bulletin.validTo);
  return Number.isFinite(validTo.getTime()) && validTo.getTime() >= now.getTime();
}

export function pruneBulletinArchive(items) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item?.id && getReferenceDate(item))
    .sort((a, b) => new Date(b.uploadedAt || b.validTo || 0) - new Date(a.uploadedAt || a.validTo || 0))
    .slice(0, BULLETIN_ARCHIVE_LIMIT);
}

function normalizeArchive(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pruned = pruneBulletinArchive(items);
  const current = pruned.find((item) => isBulletinCurrent(item)) || null;
  return {
    version: 1,
    archiveLimit: BULLETIN_ARCHIVE_LIMIT,
    current,
    items: pruned,
    updatedAt: new Date().toISOString()
  };
}

async function readPersistedArchive() {
  if (!hasPersistentStore()) return normalizeArchive(null);

  const value = await readKvValue(BULLETIN_ARCHIVE_KEY);
  if (!value) return normalizeArchive(null);
  try {
    return normalizeArchive(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return normalizeArchive(null);
  }
}

async function writePersistedArchive(archive) {
  if (!hasPersistentStore()) return false;
  return writeKvCommands([["SET", BULLETIN_ARCHIVE_KEY, JSON.stringify(archive)]]);
}

function buildBulletinRecord(input) {
  const uploadedAt = input.uploadedAt || new Date().toISOString();
  return {
    id: input.id || uploadedAt + "-" + String(input.fileName || "bollettino.pdf").replace(/[^a-z0-9_.-]+/gi, "-").toLowerCase(),
    fileName: input.fileName || "bollettino.pdf",
    level: input.level || "Verde",
    matches: Array.isArray(input.matches) ? input.matches : [],
    reason: input.reason || null,
    issue: input.issue || null,
    issuedAt: input.issuedAt || null,
    validity: input.validity || null,
    validFrom: input.validFrom || null,
    validTo: input.validTo || null,
    textPreview: input.textPreview || null,
    textTerms: Array.isArray(input.textTerms) ? input.textTerms : [],
    zoneLevels: input.zoneLevels && typeof input.zoneLevels === "object" ? input.zoneLevels : null,
    provinceLevels:
      input.provinceLevels && typeof input.provinceLevels === "object" ? input.provinceLevels : null,
    pdfUrl: input.pdfUrl || null,
    uploadedAt
  };
}

export async function getBulletinArchive() {
  const archive = await readPersistedArchive();
  const persistent = hasPersistentStore();
  return { ...archive, persistent };
}

export async function removeBulletinFromArchive(id) {
  const archive = await readPersistedArchive();
  const removed = archive.items.find((item) => item.id === id) || null;
  const items = archive.items.filter((item) => item.id !== id);
  const next = normalizeArchive({ items });
  const persistent = await writePersistedArchive(next);
  // I blocchi del PDF non devono restare orfani nel KV.
  if (persistent) await deleteSharedPdf(id, removed?.pdfChunks);
  return { ...next, persistent: hasPersistentStore(), saved: persistent };
}


export async function saveBulletinToArchive(input) {
  const archive = await readPersistedArchive();
  const record = buildBulletinRecord(input || {});

  // Un PDF incorporato (data URL) viene salvato a blocchi separati: il record
  // resta leggero e può essere rimandato a tutti i dispositivi.
  const pdfBase64 = pdfBase64FromDataUrl(record.pdfUrl);
  if (pdfBase64) record.pdfUrl = null;
  const sharedPdfChunks = pdfBase64 ? await writeSharedPdf(record.id, pdfBase64) : 0;
  record.hasSharedPdf = sharedPdfChunks > 0;
  record.pdfChunks = sharedPdfChunks || null;

  const previous = archive.items.find((item) => item.id === record.id) || null;
  const items = pruneBulletinArchive([record, ...archive.items.filter((item) => item.id !== record.id)]);
  const next = normalizeArchive({ items });
  const persistent = await writePersistedArchive(next);

  if (persistent) {
    // Bollettini usciti dall'archivio e blocchi avanzati di un PDF sostituito.
    const keptIds = new Set(next.items.map((item) => item.id));
    for (const item of archive.items) {
      if (!keptIds.has(item.id)) await deleteSharedPdf(item.id, item.pdfChunks);
    }
    if (previous?.pdfChunks) {
      for (let index = sharedPdfChunks; index < previous.pdfChunks; index += 1) {
        await writeKvCommands([["DEL", pdfChunkKey(record.id, index)]]);
      }
    }
  }

  return { ...next, current: next.current, saved: persistent, persistent: hasPersistentStore() };
}
