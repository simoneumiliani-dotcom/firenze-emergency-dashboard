const BULLETIN_ARCHIVE_KEY = process.env.BULLETIN_ARCHIVE_KEY || "firenze:bulletins:v1";
export const BULLETIN_ARCHIVE_LIMIT = Number(process.env.BULLETIN_ARCHIVE_LIMIT || 5);

function hasPersistentStore() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function getKvUrl(path) {
  return process.env.KV_REST_API_URL.replace(/\/+$/, "") + path;
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

  try {
    const response = await fetch(getKvUrl("/get/" + encodeURIComponent(BULLETIN_ARCHIVE_KEY)), {
      headers: { Authorization: "Bearer " + process.env.KV_REST_API_TOKEN },
      cache: "no-store"
    });
    if (!response.ok) return normalizeArchive(null);

    const body = await response.json();
    const value = body?.result;
    if (!value) return normalizeArchive(null);
    return normalizeArchive(typeof value === "string" ? JSON.parse(value) : value);
  } catch {
    return normalizeArchive(null);
  }
}

async function writePersistedArchive(archive) {
  if (!hasPersistentStore()) return false;

  try {
    const response = await fetch(getKvUrl("/pipeline"), {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.KV_REST_API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["SET", BULLETIN_ARCHIVE_KEY, JSON.stringify(archive)]
      ])
    });
    return response.ok;
  } catch {
    return false;
  }
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
  const items = archive.items.filter((item) => item.id !== id);
  const next = normalizeArchive({ items });
  const persistent = await writePersistedArchive(next);
  return { ...next, persistent: hasPersistentStore(), saved: persistent };
}

export async function saveBulletinToArchive(input) {
  const archive = await readPersistedArchive();
  const record = buildBulletinRecord(input || {});
  const items = pruneBulletinArchive([record, ...archive.items.filter((item) => item.id !== record.id)]);
  const next = normalizeArchive({ items });
  const persistent = await writePersistedArchive(next);
  return { ...next, current: next.current, saved: persistent, persistent: hasPersistentStore() };
}
