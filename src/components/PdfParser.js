"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, AlertTriangle, Download, Eye, FileText, XCircle } from "lucide-react";
import { DEFAULT_BULLETIN_PUBLISH_CODE, PUBLISH_CODE_STORAGE_KEY } from "@/lib/bulletinPublishCode";
import { getBulletinPdfHref, toPublicBulletin } from "@/lib/bulletinPdf";
import {
  DEFAULT_PROVINCE,
  LEVEL_NAMES,
  PROVINCE_ZONES,
  TOSCANA_PROVINCES,
  ZONE_CODES,
  getProvinceLevels,
  strongestLevel
} from "@/lib/toscanaZones";
import {
  isBulletinCurrent,
  pruneBulletins,
  readDeviceArchive,
  readDeviceCurrentBulletin,
  writeDeviceArchive,
  writeDeviceCurrentBulletin
} from "@/lib/bulletinDeviceArchive";

const PDF_DB_NAME = "firenze-bulletin-pdfs";
const PDF_DB_STORE = "pdfs";

const TERRITORY_KEYWORDS = [
  "firenze",
  "mugello",
  "valdarno",
  "ombrone bisenzio",
  "bisenzio",
  "sieve",
  "ema",
  "greve",
  "empolese",
  "chianti"
];

const LEVELS = [
  { name: "Rosso", weight: 3, patterns: [/allerta\s*-\s*codice\s+rosso/i, /criticita['’]?\s+rosso/i, /fase\s+\w+\s*-\s*rosso/i] },
  { name: "Arancione", weight: 2, patterns: [/allerta\s*-\s*codice\s+arancione/i, /criticita['’]?\s+arancione/i, /fase\s+\w+\s*-\s*arancione/i] },
  { name: "Giallo", weight: 1, patterns: [/allerta\s*-\s*codice\s+giallo/i, /criticita['’]?\s+giallo/i, /fase\s+\w+\s*-\s*giallo/i] }
];

// In tabella il livello di criticità sta a destra dell'elenco delle zone, quindi
// va letto per riga: concatenare tutto il testo del PDF produce associazioni
// sbagliate. Zone, province e relativi livelli vivono in lib/toscanaZones.js.
const ZONE_CODE_PATTERN =
  "(?:" + ZONE_CODES.slice().sort((a, b) => b.length - a.length).join("|") + ")";

function parseZoneAlertRows(text) {
  const rows = [];

  String(text || "").split("\n").forEach((rawRow) => {
    const row = rawRow.replace(/\s+/g, " ").trim();
    if (!row) return;

    const levelMatches = [...row.matchAll(/\b(verde|giallo|arancione|rosso)\b/gi)];
    if (!levelMatches.length) return;

    levelMatches.forEach((levelMatch) => {
      const before = row.slice(0, levelMatch.index);
      const lists = [
        ...before.matchAll(
          new RegExp("\\b" + ZONE_CODE_PATTERN + "(?:[\\s,;/]+" + ZONE_CODE_PATTERN + ")*\\b", "gi")
        )
      ];
      const zoneList = lists[lists.length - 1];
      if (!zoneList) return;

      // La colonna della criticità sta sulla stessa riga: se il livello è troppo
      // lontano dall'elenco delle zone non gli appartiene.
      if (before.length - (zoneList.index + zoneList[0].length) > 200) return;

      const zones = [...new Set(
        zoneList[0]
          .split(/[\s,;/]+/)
          .map((code) => code.toUpperCase())
          .filter((code) => ZONE_CODES.includes(code))
      )];
      if (!zones.length) return;

      rows.push({
        zones,
        level: LEVEL_NAMES[levelMatch[1].toLowerCase()],
        inProgress: /in\s+corso/i.test(row)
      });
    });
  });

  return rows;
}

function getZoneLevels(text) {
  const rows = parseZoneAlertRows(text);
  if (!rows.length) return null;

  // Le righe "in corso" descrivono la criticità valida adesso: quando il
  // bollettino ne contiene, le righe di previsione non devono alzare il livello
  // mostrato per nessuna zona.
  const inProgressRows = rows.filter((row) => row.inProgress);
  const selectedRows = inProgressRows.length ? inProgressRows : rows;

  const zoneLevels = {};
  selectedRows.forEach((row) => {
    row.zones.forEach((zone) => {
      zoneLevels[zone] = strongestLevel([zoneLevels[zone], row.level].filter(Boolean));
    });
  });

  return zoneLevels;
}

function getBestAlertLevel(text, province = DEFAULT_PROVINCE) {
  const lowerText = text.toLowerCase();
  const matches = TERRITORY_KEYWORDS.filter((keyword) => lowerText.includes(keyword));
  const zoneLevels = getZoneLevels(text);

  if (zoneLevels) {
    const provinceLevels = getProvinceLevels(zoneLevels);
    const sigla = TOSCANA_PROVINCES[province] ? province : DEFAULT_PROVINCE;
    const detail = PROVINCE_ZONES[sigla]
      .filter((zone) => zoneLevels[zone])
      .map((zone) => zone + " " + zoneLevels[zone])
      .join(", ");

    return {
      level: provinceLevels[sigla],
      matches,
      zoneLevels,
      provinceLevels,
      reason:
        `Livello ${provinceLevels[sigla]} per la provincia di ${TOSCANA_PROVINCES[sigla]}` +
        (detail ? ` (zone ${detail}).` : ".")
    };
  }

  if (!matches.length) {
    return { level: "Verde", matches: [], reason: "Nessuna area fiorentina rilevata nel testo." };
  }

  const sanitizedText = text.replace(/Legenda criticit[aà]:?\s*VERDE,?\s*GIALLO,?\s*ARANCIONE,?\s*ROSSO/gi, "");
  const explicitLevels = LEVELS.filter((level) => level.patterns.some((pattern) => pattern.test(sanitizedText)));

  if (explicitLevels.length) {
    const bestExplicit = explicitLevels.sort((a, b) => b.weight - a.weight)[0];
    return {
      level: bestExplicit.name,
      matches,
      reason: `Rilevato codice ufficiale ${bestExplicit.name} nel bollettino per le aree interessate.`
    };
  }

  // Se non troviamo una formula ufficiale esplicita, valutiamo una finestra attorno
  // alle parole territoriali evitando falsi positivi dovuti a legenda o altre province.
  const windows = matches.flatMap((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [...sanitizedText.matchAll(new RegExp(escaped, "gi"))].map((match) => {
      const start = Math.max(0, match.index - 900);
      const end = Math.min(sanitizedText.length, match.index + keyword.length + 900);
      return sanitizedText.slice(start, end);
    });
  });

  const best = LEVELS.find((level) => windows.some((chunk) => level.patterns.some((pattern) => pattern.test(chunk))));

  return {
    level: best?.name || "Verde",
    matches,
    reason: best ? `Rilevato livello ${best.name} in prossimita delle aree fiorentine.` : "Aree fiorentine trovate senza criticita esplicita."
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^\$\{\}()|[\]\\]/g, "\\$&");
}

const MONTHS_IT = {
  gennaio: 0,
  febbraio: 1,
  marzo: 2,
  aprile: 3,
  maggio: 4,
  giugno: 5,
  luglio: 6,
  agosto: 7,
  settembre: 8,
  ottobre: 9,
  novembre: 10,
  dicembre: 11
};

function buildIsoDate({ year, month, day, hour, minute }) {
  const date = new Date(Number(year), Number(month), Number(day), Number(hour), Number(minute), 0, 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseItalianDateText(value) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  const textDate = source.match(/(\d{1,2})[.:](\d{2})\s+di\s+(?:[A-Za-zÀ-ÿ]+,?\s+)?(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/i);
  if (textDate) {
    const [, hour, minute, day, monthName, year] = textDate;
    const month = MONTHS_IT[monthName.toLowerCase()];
    if (month === undefined) return null;
    return buildIsoDate({ year, month, day, hour, minute });
  }

  const numericDate = source.match(/(\d{1,2})[.:](\d{2})\s+del\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i);
  if (numericDate) {
    const [, hour, minute, day, month, year] = numericDate;
    return buildIsoDate({ year, month: Number(month) - 1, day, hour, minute });
  }

  const numericDateFirst = source.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}).{0,40}?ore\s+(\d{1,2})[.:](\d{2})/i);
  if (numericDateFirst) {
    const [, day, month, year, hour, minute] = numericDateFirst;
    return buildIsoDate({ year, month: Number(month) - 1, day, hour, minute });
  }

  return null;
}

function getBulletinDatePattern() {
  const textual = "\\d{1,2}[.:]\\d{2}\\s+di\\s+[A-Za-zÀ-ÿ]+,?\\s+\\d{1,2}\\s+[A-Za-zÀ-ÿ]+\\s+\\d{4}";
  const numeric = "\\d{1,2}[.:]\\d{2}\\s+del\\s+\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{4}";
  return "(?:" + textual + "|" + numeric + ")";
}

function getBulletinIssueDetails(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const datePart = getBulletinDatePattern();
  const clockPart = "\\d{1,2}[.:]\\d{2}";
  const numericDayPart = "\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{4}";
  const textualDayPart = "(?:[A-Za-zÀ-ÿ]+,?\\s+)?\\d{1,2}\\s+[A-Za-zÀ-ÿ]+\\s+\\d{4}";
  const patterns = [
    {
      regex: new RegExp("Emess[ao]\\s+alle\\s+ore\\s+(" + datePart + ")", "i"),
      build: (match) => match[1].trim()
    },
    {
      regex: new RegExp("Emess[ao]\\s+(?:il\\s+)?(" + numericDayPart + ")\\s+alle\\s+ore\\s+(" + clockPart + ")", "i"),
      build: (match) => match[2].trim() + " del " + match[1].trim()
    },
    {
      regex: new RegExp("(?:Emissione|Emess[ao])[^0-9]{0,80}(?:ore\\s+)?(" + clockPart + ")\\s*(?:del\\s+)?(" + numericDayPart + ")", "i"),
      build: (match) => match[1].trim() + " del " + match[2].trim()
    },
    {
      regex: new RegExp("(?:Emissione|Emess[ao])[^0-9]{0,80}(" + numericDayPart + ")[^0-9]{0,40}(?:ore\\s+)?(" + clockPart + ")", "i"),
      build: (match) => match[2].trim() + " del " + match[1].trim()
    },
    {
      regex: new RegExp("(?:Emissione|Emess[ao])\\s+(?:di\\s+)?(" + textualDayPart + ")[^0-9]{0,40}(?:alle\\s+)?ore\\s+(" + clockPart + ")", "i"),
      build: (match) => match[2].trim() + " di " + match[1].trim()
    }
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (match) {
      const issueText = pattern.build(match);
      return {
        label: "Emesso alle ore " + issueText,
        issuedAt: parseItalianDateText(issueText)
      };
    }
  }

  return { label: null, issuedAt: null };
}

function getBulletinValidityDetails(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const datePart = getBulletinDatePattern();

  // Il CFR usa due forme: "Valido dalle ore A alle ore B" per gli avvisi che
  // coprono due giornate e "Valido fino alle ore B" per quelli che chiudono
  // entro la stessa giornata.
  const range = normalized.match(
    new RegExp("Valid[oa]\\s+dalle\\s+ore\\s+(" + datePart + ")\\s+(?:alle|fino\\s+alle)\\s+ore\\s+(" + datePart + ")", "i")
  );
  if (range) {
    const fromText = range[1].trim();
    const toText = range[2].trim();
    return {
      label: "Valido dalle ore " + fromText + " alle ore " + toText,
      validFrom: parseItalianDateText(fromText),
      validTo: parseItalianDateText(toText)
    };
  }

  const until = normalized.match(
    new RegExp("Valid[oa]\\s+fino\\s+(?:alle\\s+ore|al)\\s+(" + datePart + ")", "i")
  );
  if (until) {
    const toText = until[1].trim();
    return {
      label: "Valido fino alle ore " + toText,
      validFrom: null,
      validTo: parseItalianDateText(toText)
    };
  }

  return { label: null, validFrom: null, validTo: null };
}


function openPdfDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) return resolve(null);

    const request = window.indexedDB.open(PDF_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_DB_STORE)) database.createObjectStore(PDF_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePdfBlob(id, file) {
  const database = await openPdfDatabase();
  if (!database || !id || !file) return false;

  return new Promise((resolve) => {
    const transaction = database.transaction(PDF_DB_STORE, "readwrite");
    transaction.objectStore(PDF_DB_STORE).put(file, id);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    transaction.onabort = () => resolve(false);
  }).finally(() => database.close());
}

export async function loadPdfBlob(id) {
  const database = await openPdfDatabase();
  if (!database || !id) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(PDF_DB_STORE, "readonly");
    const request = transaction.objectStore(PDF_DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  }).finally(() => database.close());
}

export async function removeOldPdfBlobs(validIds) {
  const database = await openPdfDatabase();
  if (!database) return;

  await new Promise((resolve) => {
    const transaction = database.transaction(PDF_DB_STORE, "readwrite");
    const store = transaction.objectStore(PDF_DB_STORE);
    const keysRequest = store.getAllKeys();
    keysRequest.onsuccess = () => {
      keysRequest.result.forEach((key) => {
        if (!validIds.includes(key)) store.delete(key);
      });
    };
    transaction.oncomplete = resolve;
    transaction.onerror = resolve;
    transaction.onabort = resolve;
  });

  database.close();
}
function buildRelevantExtract(text, matches) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const searchTerms = [...new Set([...matches, "giallo", "arancione", "rosso", "firenze", "mugello", "sieve", "valdarno"])];
  const lowerText = normalized.toLowerCase();
  const firstIndex = searchTerms
    .map((term) => lowerText.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstIndex === undefined) return normalized.slice(0, 1800);

  const start = Math.max(0, firstIndex - 600);
  const end = Math.min(normalized.length, firstIndex + 1800);
  return (start > 0 ? "... " : "") + normalized.slice(start, end) + (end < normalized.length ? " ..." : "");
}

function HighlightedText({ text, terms }) {
  if (!text) return null;
  const uniqueTerms = [...new Set(terms.filter(Boolean))];
  if (!uniqueTerms.length) return text;

  const pattern = new RegExp("(" + uniqueTerms.map(escapeRegExp).join("|") + ")", "gi");
  return String(text).split(pattern).map((part, index) => {
    const highlighted = uniqueTerms.some((term) => part.toLowerCase() === term.toLowerCase());
    if (!highlighted) return <span key={index}>{part}</span>;
    return <mark key={index} className="rounded bg-emergency-yellow/25 px-1 text-yellow-100">{part}</mark>;
  });
}

async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");

  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    // Il worker e' servito dal progetto (public/), non da una CDN esterna: nessuna
    // dipendenza di rete in piu' e stesso comportamento in ogni ambiente.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();

    // I frammenti arrivano nell'ordine interno del PDF, senza struttura: vanno
    // raggruppati per coordinata verticale per ricostruire le righe della tabella
    // "zone di allerta | rischio | tempi | criticità" prima di cercare i livelli.
    const rows = [];
    content.items.forEach((item) => {
      const fragment = typeof item.str === "string" ? item.str : "";
      if (!fragment.trim()) return;

      const x = Number(item.transform?.[4]);
      const y = Number(item.transform?.[5]);
      if (!Number.isFinite(y)) {
        rows.push({ y: null, items: [{ text: fragment, x: 0 }] });
        return;
      }

      const row = rows.find((candidate) => candidate.y !== null && Math.abs(candidate.y - y) <= 3);
      if (row) row.items.push({ text: fragment, x: Number.isFinite(x) ? x : 0 });
      else rows.push({ y, items: [{ text: fragment, x: Number.isFinite(x) ? x : 0 }] });
    });

    pageTexts.push(
      rows
        .sort((a, b) => (b.y ?? -Infinity) - (a.y ?? -Infinity))
        .map((row) =>
          row.items
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(" ")
        )
        .join("\n")
    );
  }

  return pageTexts.join("\n");
}


function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function PdfParser({
  onBulletinChange,
  currentLevel = null,
  historyOpen = false,
  onToggleHistory = null,
  refreshKey = 0
}) {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [publishCode, setPublishCode] = useState("");
  const [codePrompt, setCodePrompt] = useState(null);
  const [publishNotice, setPublishNotice] = useState(null);
  const pendingPayloadsRef = useRef([]);
  const objectUrlRef = useRef(null);

  // Il codice di pubblicazione è unico per tutti: la pagina Allerte lo chiede
  // una sola volta, già compilato con il default, e poi lo ricorda su questo browser.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PUBLISH_CODE_STORAGE_KEY);
      if (stored) setPublishCode(stored);
    } catch {
      // localStorage non disponibile: il prompt ricomparirà al prossimo invio.
    }
  }, []);

  const publishBulletin = useCallback(async (payload, codeOverride) => {
    const code = String(codeOverride || publishCode || "").trim();
    if (!code) {
      pendingPayloadsRef.current = [...pendingPayloadsRef.current, payload];
      setCodePrompt({ code: DEFAULT_BULLETIN_PUBLISH_CODE, error: null });
      return null;
    }

    try {
      const response = await fetch("/api/bulletins", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bulletin-token": code },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const archive = await response.json();
        setPublishNotice(archive?.saved === false
          ? {
              ok: false,
              message: archive.persistent
                ? "Archivio condiviso non raggiungibile: il bollettino resta su questo dispositivo."
                : "Archivio condiviso non configurato: il bollettino resta su questo dispositivo."
            }
          : { ok: true, message: "Bollettino pubblicato nell'archivio condiviso." });
        onBulletinChange?.();
        return archive;
      }

      if (response.status === 401) {
        try { window.localStorage.removeItem(PUBLISH_CODE_STORAGE_KEY); } catch {}
        setPublishCode("");
        pendingPayloadsRef.current = [...pendingPayloadsRef.current, payload];
        setPublishNotice(null);
        setCodePrompt({ code, error: "Codice non valido: controlla il codice di pubblicazione." });
        return null;
      }

      const body = await response.json().catch(() => null);
      setPublishNotice({ ok: false, message: body?.error || "Archivio condiviso non raggiungibile." });
      return null;
    } catch {
      setPublishNotice({ ok: false, message: "Archivio condiviso non raggiungibile." });
      return null;
    }
  }, [onBulletinChange, publishCode]);

  const confirmPublishCode = useCallback(async () => {
    const code = String(codePrompt?.code || "").trim();
    if (!code) return;

    try { window.localStorage.setItem(PUBLISH_CODE_STORAGE_KEY, code); } catch {}
    setPublishCode(code);
    setCodePrompt(null);

    const queue = pendingPayloadsRef.current;
    pendingPayloadsRef.current = [];
    for (const payload of queue) {
      await publishBulletin(payload, code);
    }
  }, [codePrompt, publishBulletin]);

  const cancelPublishCode = useCallback(() => {
    pendingPayloadsRef.current = [];
    setCodePrompt(null);
    setPublishNotice({
      ok: false,
      message: "Pubblicazione annullata: il bollettino resta solo su questo dispositivo."
    });
  }, []);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Un bollettino ritirato dallo storico deve sparire anche da qui: al cambio
    // di refreshKey si riparte dallo stato vuoto e si rilegge l'archivio.
    setResult(null);
    setStatus("idle");
    setViewerOpen(false);
    setExtractOpen(false);
    setPdfUrl(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    async function restoreCurrentBulletin() {
      // In localStorage restano solo i metadati: eventuali PDF incorporati in
      // record vecchi vengono scartati (si richiedono a /api/bulletins/pdf).
      const localArchive = readDeviceArchive();
      removeOldPdfBlobs(localArchive.map((item) => item.id));

      const localCurrent = readDeviceCurrentBulletin();
      if (localCurrent && isBulletinCurrent(localCurrent)) {
        const pdfBlob = await loadPdfBlob(localCurrent.id);
        const restoredPdfUrl = pdfBlob ? URL.createObjectURL(pdfBlob) : getBulletinPdfHref(localCurrent);

        if (cancelled) {
          if (restoredPdfUrl?.startsWith("blob:")) URL.revokeObjectURL(restoredPdfUrl);
          return;
        }

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = restoredPdfUrl?.startsWith("blob:") ? restoredPdfUrl : null;
        setResult(localCurrent);
        setStatus("done");
        setPdfUrl(restoredPdfUrl);
        setViewerOpen(false);
      } else if (localCurrent) {
        writeDeviceCurrentBulletin(null);
      }

      fetch("/api/bulletins", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((archive) => {
          if (cancelled || !archive) return;
          const remoteArchive = pruneBulletins((archive.items || []).map(toPublicBulletin));
          if (remoteArchive.length) {
            writeDeviceArchive(remoteArchive);
          }
          if (!archive.current || !isBulletinCurrent(archive.current)) return;

          const next = { ...toPublicBulletin(archive.current), archivePersistent: archive.persistent };
          writeDeviceCurrentBulletin(next);
          setResult(next);
          setStatus("done");
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
          setPdfUrl(getBulletinPdfHref(next));
          setViewerOpen(false);
        })
        .catch(() => {});
    }

    restoreCurrentBulletin();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("error");
      setResult({ message: "Carica un file PDF valido.", level: "Verde", matches: [] });
      return;
    }

    setStatus("reading");
    setResult(null);
    setViewerOpen(false);
    setExtractOpen(false);

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const nextPdfUrl = URL.createObjectURL(file);
    objectUrlRef.current = nextPdfUrl;
    setPdfUrl(nextPdfUrl);

    try {
      const text = await extractPdfText(file);
      const detection = getBestAlertLevel(text);
      const issueDetails = getBulletinIssueDetails(text);
      const validityDetails = getBulletinValidityDetails(text);
      const pdfDataUrl = await fileToDataUrl(file);
      const uploadedAt = new Date().toISOString();
      const payload = {
        ...detection,
        id: uploadedAt + "-" + file.name.replace(/[^a-z0-9_.-]+/gi, "-").toLowerCase(),
        fileName: file.name,
        parsedAt: new Date().toLocaleString("it-IT"),
        uploadedAt,
        issue: issueDetails.label,
        issuedAt: issueDetails.issuedAt,
        validity: validityDetails.label,
        validFrom: validityDetails.validFrom,
        validTo: validityDetails.validTo,
        pdfUrl: pdfDataUrl,
        textPreview: buildRelevantExtract(text, detection.matches),
        textTerms: [...new Set([...detection.matches, detection.level, "Firenze", "Mugello", "Valdarno", "Sieve", "Ema"])]
      };
      const savedPdf = await savePdfBlob(payload.id, file);
      const localPayload = { ...payload, pdfUrl: null, hasLocalPdf: savedPdf };
      const previousArchive = readDeviceArchive();
      const nextArchive = pruneBulletins([localPayload, ...previousArchive.filter((item) => item.id !== localPayload.id)]);
      writeDeviceArchive(nextArchive);
      writeDeviceCurrentBulletin(localPayload);
      removeOldPdfBlobs(nextArchive.map((item) => item.id));

      setResult(localPayload);
      setStatus("done");
      setViewerOpen(false);
      // Il record è già su questo dispositivo: la pagina lo mostra subito, anche
      // se la pubblicazione condivisa viene annullata o non riesce.
      onBulletinChange?.();

      await publishBulletin(payload);
    } catch {
      setStatus("error");
      setResult({
        level: "Verde",
        matches: [],
        message: "Non riesco a leggere il PDF. Verifica che non sia protetto o scansionato come immagine."
      });
    }
  }, [onBulletinChange, publishBulletin]);

  return (
    <div className="flex flex-col gap-3">
      <div
        className={"flex flex-wrap gap-2 rounded-lg transition " + (isDragging ? "ring-2 ring-sky-300" : "")}
        title="Trascina qui il PDF ufficiale per caricarlo"
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          handleFile(event.dataTransfer.files?.[0]);
        }}
      >
        <button
          type="button"
          onClick={() => onToggleHistory?.()}
          aria-expanded={Boolean(historyOpen)}
          aria-controls="storico-bollettini"
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emergency-line bg-emergency-panel2 px-3 text-xs font-semibold text-slate-200 transition hover:border-sky-400/40 hover:text-sky-100"
        >
          <Archive className="h-4 w-4 text-sky-300" />
          Archivio
        </button>
        <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20">
          <FileText className="h-4 w-4" />
          Seleziona PDF
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => handleFile(event.target.files?.[0])}
          />
        </label>
      </div>

      {status === "done" && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExtractOpen((current) => !current)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emergency-line bg-emergency-panel2 px-3 text-xs font-semibold text-slate-200 transition hover:border-sky-400/40 hover:text-sky-100"
          >
            <FileText className="h-4 w-4 text-sky-300" />
            Testo estratto
          </button>
          <button
            type="button"
            onClick={() => setViewerOpen((current) => !current)}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20"
          >
            <Eye className="h-4 w-4" />
            {viewerOpen ? "Chiudi PDF" : "Leggi bollettino"}
          </button>
          {pdfUrl && (
            <a
              href={pdfUrl}
              download={result.fileName}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emergency-line bg-emergency-panel2 px-3 text-xs font-semibold text-slate-200 transition hover:border-sky-400/40 hover:text-sky-100"
            >
              <Download className="h-4 w-4 text-sky-300" />
              Scarica
            </a>
          )}
        </div>
      )}

      {status === "reading" && <p className="text-sm text-slate-300">Lettura del PDF in corso...</p>}

      {status === "error" && (
        <div className="flex items-center gap-2 text-sm text-red-100">
          <XCircle className="h-5 w-5 text-emergency-red" />
          {result?.message || "Errore durante il caricamento."}
        </div>
      )}

      {publishNotice && (
        <p className={`rounded-lg border px-3 py-2 text-xs ${publishNotice.ok ? "border-emergency-green/40 bg-emergency-green/10 text-green-100" : "border-emergency-line bg-black/20 text-slate-300"}`}>
          {publishNotice.message}
        </p>
      )}

      {result?.level && result.level !== "Verde" && (
        <div className="flex items-start gap-2 rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 p-3 text-sm text-orange-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Verificare sempre il bollettino ufficiale prima di attivare procedure operative.
        </div>
      )}

      {viewerOpen && pdfUrl && (
        <div className="overflow-hidden rounded-lg border border-emergency-line bg-black/30">
          <div className="flex items-center justify-between border-b border-emergency-line px-3 py-2">
            <p className="text-sm font-medium text-slate-100">Bollettino ufficiale</p>
            <button type="button" onClick={() => setViewerOpen(false)} className="text-sm text-slate-400 hover:text-white">Chiudi</button>
          </div>
          <iframe
            src={pdfUrl}
            title="Anteprima bollettino PDF"
            className="h-[26rem] w-full bg-slate-950"
          />
        </div>
      )}

      {extractOpen && result?.textPreview && (
        <div className="rounded-lg border border-emergency-line bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-100">Estratto testuale rilevante</p>
            <button type="button" onClick={() => setExtractOpen(false)} className="text-sm text-slate-400 hover:text-white">Chiudi</button>
          </div>
          <p className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
            <HighlightedText text={result.textPreview} terms={result.textTerms || []} />
          </p>
        </div>
      )}

      {codePrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl border border-emergency-line bg-emergency-panel p-4 shadow-glow">
            <p className="text-base font-semibold text-slate-100">Codice di pubblicazione</p>
            <p className="mt-1 text-sm text-slate-400">
              {"Il bollettino viene pubblicato nell'archivio condiviso e compare subito in questa pagina. Conferma il codice per continuare: lo ricordiamo su questo browser."}
            </p>
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Codice</span>
              <input
                type="text"
                value={codePrompt.code}
                onChange={(event) => setCodePrompt((current) => ({ ...current, code: event.target.value, error: null }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    confirmPublishCode();
                  }
                }}
                autoComplete="off"
                className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-base text-slate-100 outline-none focus:border-sky-400 sm:text-sm"
              />
            </label>
            {codePrompt.error && <p className="mt-2 text-xs text-red-200">{codePrompt.error}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelPublishCode}
                className="min-h-11 rounded-lg border border-emergency-line bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={confirmPublishCode}
                disabled={!codePrompt.code.trim()}
                className="min-h-11 rounded-lg border border-sky-400/50 bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pubblica
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
