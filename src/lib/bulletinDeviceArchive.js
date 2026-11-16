// Archivio dei bollettini tenuto nel browser. PdfParser lo aggiorna a ogni
// caricamento; la pagina Allerte lo rilegge per mostrare subito i bollettini
// pubblicati da questo dispositivo, anche quando l'archivio condiviso non è
// configurato. Un solo posto per chiavi, ordinamento e regole di fusione.
import { toPublicBulletin } from "@/lib/bulletinPdf";

export const DEVICE_ARCHIVE_KEY = "firenze:bulletin-archive:v1";
export const DEVICE_CURRENT_KEY = "firenze:current-bulletin:v1";
export const DEVICE_ARCHIVE_LIMIT = 5;

function readJsonStorage(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Se il browser non ha spazio sufficiente, manteniamo comunque la sessione corrente.
  }
}

// Stessa regola del server: senza validTo non è possibile affermare che
// l'allerta sia ancora attiva.
export function isBulletinCurrent(item, now = new Date()) {
  if (!item?.validTo) return false;
  const validTo = new Date(item.validTo);
  return Number.isFinite(validTo.getTime()) && validTo >= now;
}

function bulletinTime(item) {
  const date = new Date(item?.uploadedAt || item?.validTo || 0);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

export function pruneBulletins(items, limit = DEVICE_ARCHIVE_LIMIT) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item?.id)
    .sort((a, b) => bulletinTime(b) - bulletinTime(a))
    .slice(0, limit);
}

// L'archivio condiviso ha la precedenza; dal dispositivo arrivano solo i
// bollettini che lì non compaiono, così nessun record viene duplicato.
export function mergeBulletins(sharedItems, deviceItems, limit = DEVICE_ARCHIVE_LIMIT) {
  const shared = Array.isArray(sharedItems) ? sharedItems : [];
  const knownIds = new Set(shared.map((item) => item.id));
  const extra = (Array.isArray(deviceItems) ? deviceItems : []).filter(
    (item) => item?.id && !knownIds.has(item.id)
  );
  return pruneBulletins([...shared, ...extra], limit);
}

// Restituisce l'archivio del dispositivo già ripulito e senza PDF incorporati.
export function readDeviceArchive() {
  const items = pruneBulletins(readJsonStorage(DEVICE_ARCHIVE_KEY, []).map(toPublicBulletin));
  writeJsonStorage(DEVICE_ARCHIVE_KEY, items);
  return items;
}

export function writeDeviceArchive(items) {
  writeJsonStorage(DEVICE_ARCHIVE_KEY, items);
}

export function readDeviceCurrentBulletin() {
  return toPublicBulletin(readJsonStorage(DEVICE_CURRENT_KEY, null));
}

export function writeDeviceCurrentBulletin(item) {
  writeJsonStorage(DEVICE_CURRENT_KEY, item);
}
