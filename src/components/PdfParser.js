"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, AlertTriangle, CheckCircle2, Download, Eye, FileText, UploadCloud, XCircle } from "lucide-react";

const LOCAL_CURRENT_KEY = "firenze:current-bulletin:v1";
const LOCAL_ARCHIVE_KEY = "firenze:bulletin-archive:v1";
const BULLETIN_ARCHIVE_LIMIT = 5;
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

function getBestAlertLevel(text) {
  const lowerText = text.toLowerCase();
  const matches = TERRITORY_KEYWORDS.filter((keyword) => lowerText.includes(keyword));

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
  const match = normalized.match(new RegExp("Valido\\s+dalle\\s+ore\\s+(" + datePart + ")\\s+alle\\s+ore\\s+(" + datePart + ")", "i"));
  if (!match) return { label: null, validFrom: null, validTo: null };

  const fromText = match[1].trim();
  const toText = match[2].trim();
  return {
    label: "Valido dalle ore " + fromText + " alle ore " + toText,
    validFrom: parseItalianDateText(fromText),
    validTo: parseItalianDateText(toText)
  };
}


function isCurrentBulletin(item) {
  if (!item?.validTo) return false;
  const validTo = new Date(item.validTo);
  return Number.isFinite(validTo.getTime()) && validTo >= new Date();
}

function pruneLocalArchive(items) {
  return [...(Array.isArray(items) ? items : [])]
    .filter((item) => item?.id)
    .sort((a, b) => new Date(b.uploadedAt || b.validTo || 0) - new Date(a.uploadedAt || a.validTo || 0))
    .slice(0, BULLETIN_ARCHIVE_LIMIT);
}

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

async function loadPdfBlob(id) {
  const database = await openPdfDatabase();
  if (!database || !id) return null;

  return new Promise((resolve) => {
    const transaction = database.transaction(PDF_DB_STORE, "readonly");
    const request = transaction.objectStore(PDF_DB_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
  }).finally(() => database.close());
}

async function removeOldPdfBlobs(validIds) {
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
    // Evita che Next/Vercel provino a minificare il worker ESM di pdf.js.
    // Il worker resta versionato con la libreria installata e viene caricato solo nel browser.
    pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(" "));
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

export default function PdfParser({ onAlertDetected }) {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archive, setArchive] = useState([]);
  const [writeToken, setWriteToken] = useState("");
  const [publishNotice, setPublishNotice] = useState(null);
  const objectUrlRef = useRef(null);

  // L'archivio condiviso decide lo stato di allerta: il token lo inserisce
  // l'operatore a runtime e resta solo in memoria, mai nel bundle o nello storage.
  const publishBulletin = useCallback(async (payload) => {
    if (!writeToken) {
      setPublishNotice({ ok: false, message: "Nessun token inserito: il bollettino resta solo su questo dispositivo." });
      return null;
    }

    try {
      const response = await fetch("/api/bulletins", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bulletin-token": writeToken },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const archive = await response.json();
        setPublishNotice(archive?.saved === false
          ? { ok: false, message: "Archivio condiviso non persistente: il bollettino resta su questo dispositivo." }
          : { ok: true, message: "Bollettino pubblicato nell'archivio condiviso." });
        return archive;
      }

      const body = await response.json().catch(() => null);
      setPublishNotice({ ok: false, message: body?.error || "Archivio condiviso non raggiungibile." });
      return null;
    } catch {
      setPublishNotice({ ok: false, message: "Archivio condiviso non raggiungibile." });
      return null;
    }
  }, [writeToken]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreCurrentBulletin() {
      const localArchive = pruneLocalArchive(readJsonStorage(LOCAL_ARCHIVE_KEY, []));
      setArchive(localArchive);
      writeJsonStorage(LOCAL_ARCHIVE_KEY, localArchive);
      removeOldPdfBlobs(localArchive.map((item) => item.id));

      const localCurrent = readJsonStorage(LOCAL_CURRENT_KEY, null);
      if (localCurrent && isCurrentBulletin(localCurrent)) {
        const pdfBlob = await loadPdfBlob(localCurrent.id);
        const restoredPdfUrl = pdfBlob ? URL.createObjectURL(pdfBlob) : localCurrent.pdfUrl || null;

        if (cancelled) {
          if (restoredPdfUrl?.startsWith("blob:")) URL.revokeObjectURL(restoredPdfUrl);
          return;
        }

        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = restoredPdfUrl?.startsWith("blob:") ? restoredPdfUrl : null;
        setResult(localCurrent);
        setStatus("done");
        setPdfUrl(restoredPdfUrl);
        setViewerOpen(Boolean(restoredPdfUrl));
        onAlertDetected?.(localCurrent);
      } else if (localCurrent) {
        writeJsonStorage(LOCAL_CURRENT_KEY, null);
      }

      fetch("/api/bulletins", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((archive) => {
          if (cancelled || !archive) return;
          const remoteArchive = pruneLocalArchive(archive.items || []);
          if (remoteArchive.length) {
            setArchive(remoteArchive);
            writeJsonStorage(LOCAL_ARCHIVE_KEY, remoteArchive);
          }
          if (!archive.current || !isCurrentBulletin(archive.current)) return;

          const next = { ...archive.current, archivePersistent: archive.persistent };
          writeJsonStorage(LOCAL_CURRENT_KEY, next);
          setResult(next);
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = null;
          }
          setPdfUrl(next.pdfUrl || null);
          setViewerOpen(Boolean(next.pdfUrl));
          onAlertDetected?.(next);
        })
        .catch(() => {});
    }

    restoreCurrentBulletin();

    return () => {
      cancelled = true;
    };
  }, [onAlertDetected]);

  const borderClass = useMemo(() => {
    if (isDragging) return "border-sky-300 bg-sky-400/10";
    if (status === "error") return "border-emergency-red/70 bg-emergency-red/10";
    if (status === "done") return "border-emergency-green/60 bg-emergency-green/10";
    return "border-dashed border-emergency-line bg-emergency-panel/90";
  }, [isDragging, status]);

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
      const previousArchive = readJsonStorage(LOCAL_ARCHIVE_KEY, []);
      const nextArchive = pruneLocalArchive([localPayload, ...previousArchive.filter((item) => item.id !== localPayload.id)]);
      writeJsonStorage(LOCAL_ARCHIVE_KEY, nextArchive);
      writeJsonStorage(LOCAL_CURRENT_KEY, localPayload);
      removeOldPdfBlobs(nextArchive.map((item) => item.id));

      setArchive(nextArchive);
      setResult(localPayload);
      setStatus("done");
      setViewerOpen(true);
      onAlertDetected?.(localPayload);

      const remoteArchive = await publishBulletin(payload);
      if (remoteArchive?.items?.length) setArchive(remoteArchive.items);
    } catch (error) {
      setStatus("error");
      setResult({
        level: "Verde",
        matches: [],
        message: "Non riesco a leggere il PDF. Verifica che non sia protetto o scansionato come immagine."
      });
    }
  }, [onAlertDetected, publishBulletin]);

  async function hydrateArchivedBulletin(item, pdfBlob) {
    if ((item.issue && item.validity) || !pdfBlob) return item;

    try {
      const text = await extractPdfText(pdfBlob);
      const detection = getBestAlertLevel(text);
      const issueDetails = getBulletinIssueDetails(text);
      const validityDetails = getBulletinValidityDetails(text);
      const enriched = {
        ...item,
        ...detection,
        issue: item.issue || issueDetails.label,
        issuedAt: item.issuedAt || issueDetails.issuedAt,
        validity: item.validity || validityDetails.label,
        validFrom: item.validFrom || validityDetails.validFrom,
        validTo: item.validTo || validityDetails.validTo,
        textPreview: item.textPreview || buildRelevantExtract(text, detection.matches),
        textTerms: item.textTerms?.length
          ? item.textTerms
          : [...new Set([...detection.matches, detection.level, "Firenze", "Mugello", "Valdarno", "Sieve", "Ema"])]
      };

      setArchive((items) => {
        const nextArchive = pruneLocalArchive([enriched, ...items.filter((entry) => entry.id !== enriched.id)]);
        writeJsonStorage(LOCAL_ARCHIVE_KEY, nextArchive);
        return nextArchive;
      });
      await publishBulletin(enriched);
      return enriched;
    } catch {
      return item;
    }
  }

  async function openArchivedBulletin(item) {
    let pdfBlob = await loadPdfBlob(item.id);
    if (!pdfBlob && item.pdfUrl) {
      try {
        const response = await fetch(item.pdfUrl);
        if (response.ok) pdfBlob = await response.blob();
      } catch {
        pdfBlob = null;
      }
    }

    const restoredPdfUrl = pdfBlob ? URL.createObjectURL(pdfBlob) : item.pdfUrl || null;
    const nextItem = await hydrateArchivedBulletin(item, pdfBlob);

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = restoredPdfUrl?.startsWith("blob:") ? restoredPdfUrl : null;
    setResult(nextItem);
    setStatus("done");
    setPdfUrl(restoredPdfUrl);
    setViewerOpen(Boolean(restoredPdfUrl));
    setExtractOpen(false);
    setArchiveOpen(false);
    onAlertDetected?.(nextItem);
  }

  return (
    <section className={`rounded-lg border p-4 shadow-glow transition ${borderClass}`}>
      <div
        className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
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
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sky-400/10 p-3 text-sky-300">
            <UploadCloud className="h-6 w-6" />
          </div>
          <div>
            <h2 className="section-title">Adozione Stato di Allerta Regionale</h2>
            <p className="mt-1 text-sm text-slate-400">
              Carica il PDF ufficiale, consulta quello valido o richiama l&apos;archivio degli ultimi 5 bollettini.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          <button
            type="button"
            onClick={() => setArchiveOpen((current) => !current)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-emergency-line bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
          >
            <Archive className="h-4 w-4" />
            Archivio
          </button>
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-sky-400/50 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20">
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
      </div>

      {archiveOpen && (
        <div className="mt-4 rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">Archivio bollettini</p>
              <p className="text-xs text-slate-400">Ultimi 5 bollettini, con PDF consultabile quando disponibile.</p>
            </div>
            <button type="button" onClick={() => setArchiveOpen(false)} className="text-sm text-slate-400 hover:text-white">Chiudi</button>
          </div>

          <div className="mb-3 rounded-lg border border-emergency-line bg-black/20 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Token archivio condiviso</span>
              <input
                type="password"
                value={writeToken}
                onChange={(event) => setWriteToken(event.target.value)}
                placeholder="Inserito dall'operatore, non viene salvato"
                autoComplete="off"
                className="rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              />
            </label>
            <p className="mt-2 text-xs text-slate-500">
              L&apos;archivio condiviso accetta solo scritture autenticate. Senza token il bollettino viene letto e conservato solo su questo dispositivo.
            </p>
          </div>

          {archive.length ? (
            <div className="grid gap-2">
              {archive.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openArchivedBulletin(item)}
                  className="rounded-lg border border-emergency-line bg-black/10 px-3 py-2 text-left hover:bg-white/[0.04]"
                >
                  <span className="block text-sm font-medium text-slate-100">{item.fileName}</span>
                  <span className="mt-1 block text-xs text-slate-400">{item.issue || "Emissione non rilevata"}</span>
                  <span className="mt-1 block text-xs text-sky-100">{item.validity || "Validita non rilevata"}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nessun bollettino archiviato.</p>
          )}
        </div>
      )}

      {status !== "idle" && (
        <div className="mt-4 rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
          {status === "reading" && <p className="text-sm text-slate-300">Lettura del PDF in corso...</p>}

          {status === "done" && result && (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emergency-green" />
                <div>
                  <button
                    type="button"
                    onClick={() => setViewerOpen((current) => !current)}
                    className="text-left text-sm font-medium text-slate-100 underline-offset-4 hover:text-sky-100 hover:underline"
                  >
                    {result.fileName}
                  </button>
                  <p className="text-xs text-slate-400">{result.reason}</p>
                  {result.issue && <p className="mt-1 text-xs font-medium text-slate-200">{result.issue}</p>}
                  {result.validity && <p className="mt-1 text-xs font-medium text-sky-100">{result.validity}</p>}
                </div>
              </div>
              <div className="rounded-lg border border-emergency-line px-3 py-2 text-sm text-slate-200">
                Livello rilevato: <span className="font-semibold">{result.level}</span>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-100">
              <XCircle className="h-5 w-5 text-emergency-red" />
              {result?.message || "Errore durante il caricamento."}
            </div>
          )}

          {status === "done" && result && (
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {result.matches?.map((match) => (
                  <span key={match} className="rounded-full border border-emergency-line bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">
                    {match}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={() => setViewerOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20"
                >
                  <Eye className="h-4 w-4" />
                  {viewerOpen ? "Chiudi PDF" : "Leggi bollettino"}
                </button>
                <button
                  type="button"
                  onClick={() => setExtractOpen((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-lg border border-emergency-line bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
                >
                  <FileText className="h-4 w-4" />
                  Testo estratto
                </button>
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    download={result.fileName}
                    className="inline-flex items-center gap-2 rounded-lg border border-emergency-line bg-white/[0.04] px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
                  >
                    <Download className="h-4 w-4" />
                    Scarica
                  </a>
                )}
              </div>
            </div>
          )}

          {publishNotice && (
            <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${publishNotice.ok ? "border-emergency-green/40 bg-emergency-green/10 text-green-100" : "border-emergency-line bg-black/20 text-slate-300"}`}>
              {publishNotice.message}
            </p>
          )}

          {result?.level && result.level !== "Verde" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 p-3 text-sm text-orange-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Verificare sempre il bollettino ufficiale prima di attivare procedure operative.
            </div>
          )}

          {viewerOpen && pdfUrl && (
            <div className="mt-3 overflow-hidden rounded-lg border border-emergency-line bg-black/30">
              <div className="flex items-center justify-between border-b border-emergency-line px-3 py-2">
                <p className="text-sm font-medium text-slate-100">Bollettino ufficiale</p>
                <button type="button" onClick={() => setViewerOpen(false)} className="text-sm text-slate-400 hover:text-white">Chiudi</button>
              </div>
              <iframe
                src={pdfUrl}
                title="Anteprima bollettino PDF"
                className="h-[32rem] w-full bg-slate-950 sm:h-[38rem]"
              />
            </div>
          )}

          {extractOpen && result?.textPreview && (
            <div className="mt-3 rounded-lg border border-emergency-line bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-100">Estratto testuale rilevante</p>
                <button type="button" onClick={() => setExtractOpen(false)} className="text-sm text-slate-400 hover:text-white">Chiudi</button>
              </div>
              <p className="max-h-56 overflow-auto whitespace-pre-wrap text-sm leading-6 text-slate-300">
                <HighlightedText text={result.textPreview} terms={result.textTerms || []} />
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
