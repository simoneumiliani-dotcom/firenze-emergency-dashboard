"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Circle,
  Download,
  ExternalLink,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PageLayout from "@/components/PageLayout";
import PdfParser, { loadPdfBlob, removeOldPdfBlobs } from "@/components/PdfParser";
import SourcesLink from "@/components/SourcesLink";
import { getBulletinPdfHref, isInlinePdfUrl } from "@/lib/bulletinPdf";
import { DEFAULT_BULLETIN_PUBLISH_CODE, PUBLISH_CODE_STORAGE_KEY } from "@/lib/bulletinPublishCode";
import { isBulletinCurrent, mergeBulletins, pruneBulletins, readDeviceArchive, readDeviceCurrentBulletin, writeDeviceArchive, writeDeviceCurrentBulletin } from "@/lib/bulletinDeviceArchive";
import { PROVINCE_ZONES, ZONE_NAMES } from "@/lib/toscanaZones";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const LEVEL_ORDER = ["Verde", "Giallo", "Arancione", "Rosso"];
const LEVEL_STYLE = {
  Verde: "border-emergency-green/60 bg-emergency-green/10 text-emergency-green",
  Giallo: "border-emergency-yellow/70 bg-emergency-yellow/10 text-emergency-yellow",
  Arancione: "border-emergency-orange/70 bg-emergency-orange/10 text-emergency-orange",
  Rosso: "border-emergency-red/70 bg-emergency-red/10 text-emergency-red"
};
const LEVEL_DOT = {
  Verde: "bg-emergency-green",
  Giallo: "bg-emergency-yellow",
  Arancione: "bg-emergency-orange",
  Rosso: "bg-emergency-red"
};
const LEVEL_ICON = {
  Verde: "text-emergency-green",
  Giallo: "text-emergency-yellow",
  Arancione: "text-emergency-orange",
  Rosso: "text-emergency-red"
};
// Forma dell'icona per livello: quadrato giallo, tondo arancione, triangolo
// rosso. Il verde (nessuna allerta) resta il triangolo verde di prima.
const LEVEL_SHAPE = {
  Verde: AlertTriangle,
  Giallo: Square,
  Arancione: Circle,
  Rosso: AlertTriangle
};

function normalizeLevel(value) {
  return LEVEL_ORDER.includes(value) ? value : "Verde";
}

function levelWeight(value) {
  return Math.max(0, LEVEL_ORDER.indexOf(normalizeLevel(value)));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return "non indicato";
  return date.toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatValidity(item) {
  const from = parseDate(item?.validFrom);
  const to = parseDate(item?.validTo);
  if (from && to) return formatDateTime(from) + " - " + formatDateTime(to);
  if (to) return "fino a " + formatDateTime(to);
  return item?.validity || "validità non indicata";
}

// Zone del bollettino con almeno un comune in provincia di Firenze, con codice
// e nome: la card e lo storico leggono gli stessi dati.
function fiorentineZones(item) {
  return PROVINCE_ZONES.FI.filter((zone) => item?.zoneLevels?.[zone]);
}

function zoneLabel(zone) {
  return zone + " " + ZONE_NAMES[zone];
}

// Rischio che determina il livello mostrato: distingue, per esempio, un giallo
// per vento da uno per idrogeologico.
function riskNote(item, zone, level) {
  const risks = item?.zoneRisks?.[zone];
  if (!risks) return "";
  const names = Object.keys(risks).filter((risk) => risks[risk] === level);
  return names.length ? " · " + names.join(", ") : "";
}

const PDF_LINK_CLASS =
  "text-left underline decoration-slate-500 decoration-dotted underline-offset-2 transition hover:text-sky-100 hover:decoration-sky-300";

// La validità di ogni bollettino apre il PDF relativo in una nuova finestra.
// Per i record solo su questo dispositivo il file arriva da IndexedDB.
function ValidityPdfLink({ item }) {
  const label = formatValidity(item);
  const href = getBulletinPdfHref(item);

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title="Apri il PDF del bollettino in una nuova finestra"
        className={PDF_LINK_CLASS}
      >
        {label}
      </a>
    );
  }

  if (item?.hasLocalPdf) {
    return (
      <button
        type="button"
        onClick={async () => {
          // La finestra si apre subito, nel gesto dell'utente: il browser non la
          // blocca, e riceve il file appena IndexedDB lo restituisce.
          const viewer = window.open("", "_blank");
          const pdfBlob = await loadPdfBlob(item.id);
          if (!pdfBlob) {
            viewer?.close();
            return;
          }
          const url = URL.createObjectURL(pdfBlob);
          if (viewer) viewer.location.href = url;
          else window.open(url, "_blank", "noopener");
          window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
        }}
        title="Apri il PDF del bollettino in una nuova finestra"
        className={PDF_LINK_CLASS}
      >
        {label}
      </button>
    );
  }

  return <span>{label}</span>;
}

function formatResidual(validTo, now) {
  const date = parseDate(validTo);
  if (!date) return "non indicata";
  const minutes = Math.round((date.getTime() - now) / 60000);
  if (minutes <= 0) {
    const elapsed = Math.abs(minutes);
    const hours = Math.floor(elapsed / 60);
    return "scaduto" + (hours >= 1 ? " da " + hours + " h" : " da " + elapsed + " min");
  }
  if (minutes < 60) return "restano " + minutes + " min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return "restano " + hours + " h" + (rest ? " " + rest + " min" : "");
}

function formatDelta(currentLevel, previousLevel) {
  if (!previousLevel) return { label: "primo bollettino", Icon: null, className: "text-slate-500" };
  const delta = levelWeight(currentLevel) - levelWeight(previousLevel);
  if (delta > 0) return { label: "in aumento da " + normalizeLevel(previousLevel), Icon: ArrowUp, className: "text-emergency-orange" };
  if (delta < 0) return { label: "in calo da " + normalizeLevel(previousLevel), Icon: ArrowDown, className: "text-emergency-green" };
  return { label: "invariato", Icon: ArrowRight, className: "text-slate-400" };
}

function LevelBadge({ level, size = "sm" }) {
  const value = normalizeLevel(level);
  return (
    <span
      className={
        "inline-flex items-center gap-2 rounded-md border font-semibold " +
        (size === "lg" ? "px-3 py-1.5 text-sm " : "px-2 py-1 text-xs ") +
        LEVEL_STYLE[value]
      }
    >
      <span className={"h-2 w-2 rounded-full " + LEVEL_DOT[value]} />
      {value}
    </span>
  );
}

function BulletinPdfLink({ item, label }) {
  const href = getBulletinPdfHref(item);
  if (!href) return <span className="text-xs text-slate-600">—</span>;
  const isDownload = isInlinePdfUrl(item.pdfUrl) || item.hasEmbeddedPdf;

  return isDownload ? (
    <a
      href={href}
      download={item.fileName || "bollettino.pdf"}
      className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-sky-200 hover:underline"
    >
      {label || "Scarica"}
      <Download className="h-3 w-3" />
    </a>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-sky-200 hover:underline"
    >
      {label || "Apri"}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export default function AllertePage() {
  const [archive, setArchive] = useState(null);
  const [deviceItems, setDeviceItems] = useState([]);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeCode, setRemoveCode] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [removeNotice, setRemoveNotice] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const historyRef = useRef(null);

  const loadArchive = useCallback(async ({ quiet = false } = {}) => {
    // La copia del dispositivo è ciò che il riquadro PDF ha già caricato qui:
    // si legge a ogni giro, anche quando il server non conserva l'archivio.
    setDeviceItems(readDeviceArchive());
    try {
      const response = await fetch("/api/bulletins", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      setArchive(await response.json());
      setError(null);
    } catch {
      if (!quiet) setError("Archivio dei bollettini non raggiungibile in questo momento.");
    } finally {
      setNow(Date.now());
    }
  }, []);

  // Il riquadro PDF pubblica nell'archivio: al cambio rileggiamo i dati senza
  // mostrare il caricamento, così il bollettino appare subito in pagina.
  const handleBulletinChange = useCallback(() => loadArchive({ quiet: true }), [loadArchive]);

  // Ritiro di un bollettino pubblicato per errore: la funzione che stava nel
  // vecchio archivio locale ora vive qui, nello storico.
  const openRemoveDialog = useCallback((item) => {
    let remembered = DEFAULT_BULLETIN_PUBLISH_CODE;
    try {
      remembered = window.localStorage.getItem(PUBLISH_CODE_STORAGE_KEY) || DEFAULT_BULLETIN_PUBLISH_CODE;
    } catch {}
    setRemoveTarget(item);
    setRemoveCode(remembered);
    setRemoveError(null);
    setRemoveNotice(null);
  }, []);

  const confirmRemove = useCallback(async () => {
    const code = removeCode.trim();
    if (!code || !removeTarget || removing) return;

    setRemoving(true);
    setRemoveError(null);
    const id = removeTarget.id;

    try {
      const response = await fetch("/api/bulletins?id=" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "x-bulletin-token": code }
      });

      if (response.status === 401) {
        try { window.localStorage.removeItem(PUBLISH_CODE_STORAGE_KEY); } catch {}
        setRemoveError("Codice non valido: controlla il codice di pubblicazione.");
        return;
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRemoveError(body?.error || "Rimozione non riuscita: server non raggiungibile.");
        return;
      }

      try { window.localStorage.setItem(PUBLISH_CODE_STORAGE_KEY, code); } catch {}

      // Stessa pulizia che faceva il vecchio archivio: copia sul dispositivo,
      // PDF in IndexedDB e bollettino corrente.
      const nextLocal = pruneBulletins(readDeviceArchive().filter((item) => item.id !== id));
      writeDeviceArchive(nextLocal);
      setDeviceItems(nextLocal);
      await removeOldPdfBlobs(nextLocal.map((item) => item.id));
      if (readDeviceCurrentBulletin()?.id === id) writeDeviceCurrentBulletin(null);

      setRemoveTarget(null);
      setRemoveNotice({ ok: true, message: "Bollettino rimosso dallo storico." });
      setRefreshKey((key) => key + 1);
      await loadArchive({ quiet: true });
    } catch {
      setRemoveError("Rimozione non riuscita: server non raggiungibile.");
    } finally {
      setRemoving(false);
    }
  }, [loadArchive, removeCode, removeTarget, removing]);

  useEffect(() => {
    loadArchive();
    const timer = window.setInterval(() => loadArchive({ quiet: true }), REFRESH_INTERVAL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [loadArchive]);

  // Il pulsante Archivio apre lo storico più in basso: senza scorrimento, su
  // schermo piccolo la sezione resterebbe fuori vista.
  useEffect(() => {
    if (!historyOpen) return;
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [historyOpen]);

  // Archivio condiviso più la copia del dispositivo, senza doppioni: il bollettino
  // appena caricato qui resta visibile anche senza archivio condiviso.
  const items = useMemo(() => {
    const sharedItems = Array.isArray(archive?.items) ? archive.items : [];
    return mergeBulletins(sharedItems, deviceItems, archive?.archiveLimit);
  }, [archive, deviceItems]);

  // Solo i bollettini presenti nell'archivio condiviso possono essere ritirati
  // dal server: quelli rimasti solo su questo dispositivo non hanno un record remoto.
  const sharedIds = useMemo(
    () => new Set((Array.isArray(archive?.items) ? archive.items : []).map((item) => item.id)),
    [archive]
  );

  // Solo un bollettino con scadenza futura è "in corso": senza validTo non è
  // possibile affermare che l'allerta sia ancora attiva.
  const current = useMemo(
    () => items.find((item) => isBulletinCurrent(item, new Date(now))) || null,
    [items, now]
  );

  const currentLevel = normalizeLevel(current?.level);
  const currentZones = fiorentineZones(current);
  const currentPdfHref = getBulletinPdfHref(current);
  const currentPdfIsDownload = isInlinePdfUrl(current?.pdfUrl) || Boolean(current?.hasEmbeddedPdf);
  const archivedCount = items.length;
  // items arriva dal più recente: senza allerta valida resta utile mostrare
  // l'ultimo bollettino pubblicato, invece di lasciare la scheda vuota.
  const lastArchived = items[0] || null;

  return (
    <PageLayout>
          <PageHeader
            eyebrow="Protezione civile · CFR Toscana"
            title="Allerte e criticità"
          >
            <div className={"w-full rounded-lg border px-4 py-3 md:w-64 " + (current ? LEVEL_STYLE[currentLevel] : "border-emergency-line bg-emergency-panel2 text-slate-300")}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm font-medium">{current ? "Livello in corso" : "Nessun bollettino valido"}</span>
              </div>
              <p className="mt-1 text-2xl font-semibold">{current ? currentLevel : "—"}</p>
              <p className="mt-1 max-w-[16rem] text-xs opacity-90">
                {current ? formatResidual(current.validTo, now) : "Il livello compare solo dopo la pubblicazione di un bollettino."}
              </p>
            </div>
          </PageHeader>

          {error && (
            <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{error}</div>
          )}

          <section className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Bollettino corrente</h2>
              {current ? <LevelBadge level={currentLevel} size="lg" /> : null}
            </div>

            <div className="mt-4 flex flex-col gap-4">
              {current ? (
                <>
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Emesso il</dt>
                      <dd className="mt-1 text-slate-200">{formatDateTime(current.issuedAt || current.uploadedAt)}</dd>
                    </div>
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Validità</dt>
                      <dd className="mt-1 text-slate-200"><ValidityPdfLink item={current} /></dd>
                    </div>
                  </dl>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Aree fiorentine interessate</p>
                    {currentZones.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {currentZones.map((zone) => {
                          const zoneLevel = normalizeLevel(current.zoneLevels[zone]);
                          const ZoneIcon = LEVEL_SHAPE[zoneLevel];
                          const label = zoneLabel(zone);
                          return (
                            <span
                              key={zone}
                              title={label + ": allerta " + zoneLevel + riskNote(current, zone, zoneLevel)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-emergency-line bg-emergency-panel2 px-2 py-1 text-xs text-slate-200"
                            >
                              <ZoneIcon
                                aria-hidden="true"
                                className={"h-3.5 w-3.5 fill-current " + LEVEL_ICON[zoneLevel]}
                              />
                              {label}
                              <span className="text-slate-400">
                                {" " + zoneLevel + riskNote(current, zone, zoneLevel)}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">Nessuna area fiorentina interessata dal bollettino.</p>
                    )}
                  </div>

                  {currentPdfHref && (
                    <a
                      href={currentPdfHref}
                      {...(currentPdfIsDownload
                        ? { download: current.fileName || "bollettino.pdf" }
                        : { target: "_blank", rel: "noreferrer" })}
                      className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20"
                    >
                      {currentPdfIsDownload ? "Scarica bollettino PDF" : "Apri bollettino PDF"}
                      {currentPdfIsDownload
                        ? <Download className="h-3.5 w-3.5" />
                        : <ExternalLink className="h-3.5 w-3.5" />}
                    </a>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-emergency-line bg-emergency-panel2 px-4 py-5">
                    <div className="flex items-center gap-2 text-slate-200">
                      <ShieldCheck className="h-5 w-5 text-emergency-green" />
                      <p className="text-sm font-semibold">Nessuna allerta in corso</p>
                    </div>
                    <p className="max-w-xl text-sm leading-6 text-slate-400">
                      Non risulta un bollettino con validità ancora aperta. Carica e pubblica il bollettino con i comandi qui sotto: una volta pubblicato, il livello compare qui.
                    </p>
                  </div>

                  {lastArchived && (
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ultimo bollettino pubblicato</p>
                        <LevelBadge level={normalizeLevel(lastArchived.level)} />
                      </div>
                      <p className="mt-2 text-sm text-slate-200"><ValidityPdfLink item={lastArchived} /></p>
                      <p className="mt-1 text-sm leading-6 text-slate-400">{lastArchived.reason || "Motivazione non registrata."}</p>
                      <div className="mt-1">
                        <BulletinPdfLink item={lastArchived} label="Apri il PDF" />
                      </div>
                    </div>
                  )}
                </>
              )}

              <PdfParser
                currentLevel={current ? currentLevel : null}
                onBulletinChange={handleBulletinChange}
                historyOpen={historyOpen}
                onToggleHistory={() => setHistoryOpen((open) => !open)}
                refreshKey={refreshKey}
              />
            </div>
          </section>
          {historyOpen && (
          <section id="storico-bollettini" ref={historyRef} className="panel scroll-mt-24 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-white">Storico bollettini</h2>
                <p className="mt-1 text-sm text-slate-400">Le ultime pubblicazioni conservate, dalla più recente, con la variazione di livello rispetto al bollettino precedente.</p>
              </div>
              <span className="text-xs text-slate-500">{archivedCount} record</span>
            </div>

            {removeNotice && (
              <p className="mt-3 rounded-lg border border-emergency-green/40 bg-emergency-green/10 px-3 py-2 text-xs text-green-100">
                {removeNotice.message}
              </p>
            )}

            {archivedCount ? (
              <>
              <div className="mt-4 grid gap-2 md:hidden">
                {items.map((item, index) => {
                  const level = normalizeLevel(item.level);
                  const delta = formatDelta(level, items[index + 1]?.level);
                  const DeltaIcon = delta.Icon;
                  const isCurrent = current?.id === item.id;
                  return (
                    <article key={item.id} className={"rounded-lg border border-emergency-line px-3 py-3 " + (isCurrent ? "bg-sky-400/[0.06]" : "bg-black/10")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">{formatDateTime(item.uploadedAt || item.validTo)}</p>
                          {isCurrent && <span className="mt-1 inline-block rounded border border-sky-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">in corso</span>}
                        </div>
                        <LevelBadge level={level} />
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs">
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-slate-500">Validità</dt>
                          <dd className="min-w-0 text-slate-200"><ValidityPdfLink item={item} /></dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-slate-500">Variazione</dt>
                          <dd className={"inline-flex items-center gap-1 " + delta.className}>
                            {DeltaIcon ? <DeltaIcon className="h-3.5 w-3.5" /> : null}
                            {delta.label}
                          </dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-20 shrink-0 text-slate-500">Aree</dt>
                          <dd className="min-w-0 text-slate-400">{fiorentineZones(item).map(zoneLabel).join(", ") || "—"}</dd>
                        </div>
                        {item.reason && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-500">Motivo</dt>
                            <dd className="min-w-0 text-slate-400">{item.reason}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-emergency-line/60 pt-1">
                        <BulletinPdfLink item={item} />
                        {sharedIds.has(item.id) && (
                          <button
                            type="button"
                            onClick={() => openRemoveDialog(item)}
                            aria-label={"Rimuovi " + (item.fileName || "il bollettino") + " dall'archivio"}
                            title="Rimuovi dall'archivio"
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-emergency-line px-2 text-slate-400 hover:border-emergency-red/60 hover:bg-emergency-red/10 hover:text-red-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-emergency-line text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Pubblicato</th>
                      <th className="py-2 pr-3 font-medium">Livello</th>
                      <th className="py-2 pr-3 font-medium">Validità</th>
                      <th className="py-2 pr-3 font-medium">Variazione</th>
                      <th className="py-2 pr-3 font-medium">Aree</th>
                      <th className="py-2 pr-3 font-medium">Motivo</th>
                      <th className="py-2 pr-3 font-medium">PDF</th>
                      <th className="py-2 font-medium">Rimuovi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const level = normalizeLevel(item.level);
                      const delta = formatDelta(level, items[index + 1]?.level);
                      const DeltaIcon = delta.Icon;
                      const isCurrent = current?.id === item.id;
                      return (
                        <tr key={item.id} className={"border-b border-emergency-line/60 align-top " + (isCurrent ? "bg-sky-400/[0.06]" : "")}>
                          <td className="py-3 pr-3 whitespace-nowrap text-slate-300">
                            {formatDateTime(item.uploadedAt || item.validTo)}
                            {isCurrent && <span className="ml-2 rounded border border-sky-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-sky-200">in corso</span>}
                          </td>
                          <td className="py-3 pr-3"><LevelBadge level={level} /></td>
                          <td className="py-3 pr-3 text-slate-300"><ValidityPdfLink item={item} /></td>
                          <td className={"py-3 pr-3 " + delta.className}>
                            <span className="inline-flex items-center gap-1">
                              {DeltaIcon ? <DeltaIcon className="h-3.5 w-3.5" /> : null}
                              {delta.label}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-400">
                            {fiorentineZones(item).map(zoneLabel).join(", ") || "—"}
                          </td>
                          <td className="max-w-[18rem] py-3 pr-3 text-slate-400">
                            <span className="line-clamp-2">{item.reason || "—"}</span>
                          </td>
                          <td className="py-3 pr-3">
                            <BulletinPdfLink item={item} />
                          </td>
                          <td className="py-3">
                            {sharedIds.has(item.id) ? (
                              <button
                                type="button"
                                onClick={() => openRemoveDialog(item)}
                                aria-label={"Rimuovi " + (item.fileName || "il bollettino") + " dall'archivio"}
                                title="Rimuovi dall'archivio"
                                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-emergency-line px-2 text-slate-400 hover:border-emergency-red/60 hover:bg-emergency-red/10 hover:text-red-100"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-xs text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-emergency-line bg-emergency-panel2 px-4 py-6 text-sm text-slate-400">
                Nessun bollettino archiviato. La pubblicazione avviene dalla scheda Bollettino corrente, qui sopra: basta un bollettino valido e la conferma del codice di pubblicazione.
              </div>
            )}
          </section>
          )}

          {removeTarget && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
              <div className="w-full max-w-md rounded-xl border border-emergency-line bg-emergency-panel p-4 shadow-glow">
                <p className="text-base font-semibold text-slate-100">Rimuovi il bollettino</p>
                <p className="mt-1 text-sm text-slate-400">
                  {(removeTarget.fileName || "Il bollettino") + " viene rimosso dallo storico: se era quello in corso, il livello in pagina torna a quello precedente. Conferma il codice per continuare."}
                </p>
                <label className="mt-3 flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Codice</span>
                  <input
                    type="text"
                    value={removeCode}
                    onChange={(event) => {
                      setRemoveCode(event.target.value);
                      setRemoveError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        confirmRemove();
                      }
                    }}
                    autoComplete="off"
                    className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-base text-slate-100 outline-none focus:border-sky-400 sm:text-sm"
                  />
                </label>
                {removeError && <p className="mt-2 text-xs text-red-200">{removeError}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveTarget(null);
                      setRemoveError(null);
                    }}
                    className="min-h-11 rounded-lg border border-emergency-line bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={confirmRemove}
                    disabled={!removeCode.trim() || removing}
                    className="min-h-11 rounded-lg border border-emergency-red/60 bg-emergency-red/15 px-4 py-2 text-sm font-medium text-red-100 hover:bg-emergency-red/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removing ? "Rimozione..." : "Rimuovi"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <footer className="flex flex-col gap-1 pb-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Fonte: bollettini di criticità idraulica e idrogeologica CFR Toscana, pubblicati da questa pagina. Il livello mostrato è quello estratto dal bollettino più recente ancora valido; in assenza di bollettini validi la pagina non stima un livello.
            </p>
            <SourcesLink section="allerte" label="Fonti e bollettini" />
          </footer>
    </PageLayout>
  );
}
