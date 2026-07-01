"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, UploadCloud, XCircle } from "lucide-react";

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

export default function PdfParser({ onAlertDetected }) {
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

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

    try {
      const text = await extractPdfText(file);
      const detection = getBestAlertLevel(text);
      const payload = {
        ...detection,
        fileName: file.name,
        parsedAt: new Date().toLocaleString("it-IT"),
        textPreview: text.slice(0, 900)
      };
      setResult(payload);
      setStatus("done");
      onAlertDetected?.(payload);
    } catch (error) {
      setStatus("error");
      setResult({
        level: "Verde",
        matches: [],
        message: "Non riesco a leggere il PDF. Verifica che non sia protetto o scansionato come immagine."
      });
    }
  }, [onAlertDetected]);

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
            <h2 className="section-title">Caricamento bollettino PDF</h2>
            <p className="mt-1 text-sm text-slate-400">
              Trascina il PDF ufficiale o selezionalo per estrarre automaticamente criticita e zone fiorentine.
            </p>
          </div>
        </div>

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

      {status !== "idle" && (
        <div className="mt-4 rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
          {status === "reading" && <p className="text-sm text-slate-300">Lettura del PDF in corso...</p>}

          {status === "done" && result && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emergency-green" />
                <div>
                  <p className="text-sm font-medium text-slate-100">{result.fileName}</p>
                  <p className="text-xs text-slate-400">{result.reason}</p>
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

          {!!result?.matches?.length && (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.matches.map((match) => (
                <span key={match} className="rounded-full border border-emergency-line bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">
                  {match}
                </span>
              ))}
            </div>
          )}

          {result?.level && result.level !== "Verde" && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 p-3 text-sm text-orange-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Verificare sempre il bollettino ufficiale prima di attivare procedure operative.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
