"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Archive,
  Clock,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  RefreshCcw,
  ShieldCheck
} from "lucide-react";
import AppNav from "@/components/AppNav";
import { getBulletinPdfHref, isInlinePdfUrl } from "@/lib/bulletinPdf";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [textOpen, setTextOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const loadArchive = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/bulletins", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      setArchive(await response.json());
      setError(null);
    } catch {
      setError("Archivio dei bollettini non raggiungibile in questo momento.");
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    loadArchive();
    const timer = window.setInterval(loadArchive, REFRESH_INTERVAL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [loadArchive]);

  const items = useMemo(() => (Array.isArray(archive?.items) ? archive.items : []), [archive]);

  // Solo un bollettino con scadenza futura è "in corso": senza validTo non è
  // possibile affermare che l'allerta sia ancora attiva.
  const current = useMemo(
    () => items.find((item) => {
      const validTo = parseDate(item?.validTo);
      return validTo && validTo.getTime() >= now;
    }) || null,
    [items, now]
  );

  const currentLevel = normalizeLevel(current?.level);
  const hasActiveAlert = Boolean(current) && currentLevel !== "Verde";
  const areas = Array.isArray(current?.matches) ? current.matches : [];
  const archivedCount = items.length;
  const archiveLimit = archive?.archiveLimit || items.length;
  const sharedArchive = archive?.persistent !== false;

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <header className="panel flex flex-col gap-4 p-4 sm:p-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Protezione civile · CFR Toscana</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Allerte e criticità</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-400">
                Livello in corso, finestra di validità e motivazione dei bollettini di criticità idraulica e idrogeologica che interessano il territorio fiorentino, con lo storico delle pubblicazioni.
              </p>
            </div>
            <div className={"w-full rounded-lg border px-4 py-3 sm:w-auto " + (current ? LEVEL_STYLE[currentLevel] : "border-emergency-line bg-emergency-panel2 text-slate-300")}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-sm font-medium">{current ? "Livello in corso" : "Nessun bollettino valido"}</span>
              </div>
              <p className="mt-1 text-2xl font-semibold">{current ? currentLevel : "—"}</p>
              <p className="mt-1 max-w-[16rem] text-xs opacity-90">
                {current ? formatResidual(current.validTo, now) : "La dashboard mostra il livello solo dopo la pubblicazione di un bollettino."}
              </p>
            </div>
          </header>

          {error && (
            <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{error}</div>
          )}

          {archive && !sharedArchive && (
            <div className="rounded-lg border border-emergency-orange/40 bg-emergency-orange/5 px-4 py-3 text-sm text-orange-100">
              Archivio condiviso non configurato su questo server: i bollettini pubblicati da altri dispositivi non sono visibili qui.
            </div>
          )}

          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <article className="panel p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Bollettino corrente</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{current?.issue || "Criticità idraulica e idrogeologica"}</h2>
                </div>
                {current ? <LevelBadge level={currentLevel} size="lg" /> : null}
              </div>

              {current ? (
                <>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Emesso il</dt>
                      <dd className="mt-1 text-slate-200">{formatDateTime(current.issuedAt || current.uploadedAt)}</dd>
                    </div>
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Validità</dt>
                      <dd className="mt-1 text-slate-200">{formatValidity(current)}</dd>
                    </div>
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">Fascia oraria</dt>
                      <dd className="mt-1 text-slate-200">{current.validity || "non indicata"}</dd>
                    </div>
                    <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2">
                      <dt className="text-xs uppercase tracking-wide text-slate-500">File di riferimento</dt>
                      <dd className="mt-1 truncate text-slate-200" title={current.fileName}>{current.fileName}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Motivazione</p>
                    <p className="mt-1 text-sm leading-6 text-slate-200">
                      {current.reason || "Nessuna motivazione estratta dal bollettino."}
                    </p>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Aree fiorentine interessate</p>
                    {areas.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {areas.map((area) => (
                          <span key={area} className="inline-flex items-center gap-1.5 rounded-md border border-emergency-line bg-emergency-panel2 px-2 py-1 text-xs text-slate-200">
                            <MapPin className="h-3.5 w-3.5 text-sky-300" />
                            {area}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">Aree non specificate nel bollettino.</p>
                    )}
                  </div>

                  {current.textPreview && (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setTextOpen((value) => !value)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-emergency-line bg-emergency-panel2 px-3 text-xs font-semibold text-slate-200 transition hover:border-sky-400/40 hover:text-sky-100"
                        aria-expanded={textOpen}
                      >
                        <FileText className="h-4 w-4 text-sky-300" />
                        {textOpen ? "Nascondi testo estratto" : "Mostra testo estratto"}
                      </button>
                      {textOpen && (
                        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-emergency-line bg-emergency-ink/70 px-3 py-3 text-xs leading-5 text-slate-300">
                          {current.textPreview}
                        </pre>
                      )}
                    </div>
                  )}

                  {getBulletinPdfHref(current) && ((isInlinePdfUrl(current.pdfUrl) || current.hasEmbeddedPdf) ? (
                    <a
                      href={getBulletinPdfHref(current)}
                      download={current.fileName || "bollettino.pdf"}
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20"
                    >
                      Scarica bollettino PDF
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <a
                      href={getBulletinPdfHref(current)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20"
                    >
                      Apri bollettino PDF
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ))}
                </>
              ) : (
                <div className="mt-5 flex flex-col items-start gap-3 rounded-md border border-dashed border-emergency-line bg-emergency-panel2 px-4 py-6">
                  <div className="flex items-center gap-2 text-slate-200">
                    <ShieldCheck className="h-5 w-5 text-emergency-green" />
                    <p className="text-sm font-semibold">Nessuna allerta in corso</p>
                  </div>
                  <p className="max-w-xl text-sm leading-6 text-slate-400">
                    Non risulta un bollettino con validità ancora aperta. Il bollettino viene caricato e pubblicato dalla dashboard: una volta pubblicato, il livello compare anche qui.
                  </p>
                  <Link
                    href="/"
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20"
                  >
                    Vai alla dashboard
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </article>

            <aside className="panel p-4 sm:p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sintesi</p>
              <div className="mt-3 flex flex-col gap-3">
                <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Stato</p>
                  <p className={"mt-1 text-sm font-semibold " + (hasActiveAlert ? "text-orange-100" : "text-green-100")}>
                    {current ? (hasActiveAlert ? "Allerta " + currentLevel : "Criticità assente (verde)") : "Nessun bollettino valido"}
                  </p>
                </div>
                <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-3">
                  <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <Clock className="h-3.5 w-3.5 text-sky-300" />
                    Validità residua
                  </p>
                  <p className="mt-1 text-sm text-slate-200">{current ? formatResidual(current.validTo, now) : "—"}</p>
                </div>
                <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-3">
                  <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                    <Archive className="h-3.5 w-3.5 text-sky-300" />
                    Archivio
                  </p>
                  <p className="mt-1 text-sm text-slate-200">{archivedCount} di {archiveLimit} bollettini conservati</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {sharedArchive ? "Archivio condiviso attivo" : "Solo memoria locale del server"}
                  </p>
                </div>
                <div className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Ultimo aggiornamento</p>
                  <p className="mt-1 text-sm text-slate-200">{archive?.updatedAt ? formatDateTime(archive.updatedAt) : loading ? "caricamento…" : "non disponibile"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={loadArchive}
                disabled={loading}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-sky-400/60 bg-sky-400/10 px-4 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCcw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
                Aggiorna archivio
              </button>
            </aside>
          </section>

          <section className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-white">Storico bollettini</h2>
                <p className="mt-1 text-sm text-slate-400">Le ultime pubblicazioni conservate, dalla più recente, con la variazione di livello rispetto al bollettino precedente.</p>
              </div>
              <span className="text-xs text-slate-500">{archivedCount} record</span>
            </div>

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
                          <dd className="min-w-0 text-slate-200">{formatValidity(item)}</dd>
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
                          <dd className="min-w-0 text-slate-400">{Array.isArray(item.matches) && item.matches.length ? item.matches.join(", ") : "—"}</dd>
                        </div>
                        {item.reason && (
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-500">Motivo</dt>
                            <dd className="min-w-0 text-slate-400">{item.reason}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="mt-2 border-t border-emergency-line/60 pt-1">
                        <BulletinPdfLink item={item} />
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
                      <th className="py-2 font-medium">PDF</th>
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
                          <td className="py-3 pr-3 text-slate-300">{formatValidity(item)}</td>
                          <td className={"py-3 pr-3 " + delta.className}>
                            <span className="inline-flex items-center gap-1">
                              {DeltaIcon ? <DeltaIcon className="h-3.5 w-3.5" /> : null}
                              {delta.label}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-400">
                            {Array.isArray(item.matches) && item.matches.length ? item.matches.join(", ") : "—"}
                          </td>
                          <td className="max-w-[18rem] py-3 pr-3 text-slate-400">
                            <span className="line-clamp-2">{item.reason || "—"}</span>
                          </td>
                          <td className="py-3">
                            <BulletinPdfLink item={item} />
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
                Nessun bollettino archiviato. La pubblicazione avviene dalla dashboard, nella sezione di caricamento PDF: basta un bollettino valido e la conferma del codice di pubblicazione.
              </div>
            )}
          </section>

          <footer className="pb-6 text-xs text-slate-500">
            Fonte: bollettini di criticità idraulica e idrogeologica CFR Toscana, pubblicati dalla dashboard aziendale. Il livello mostrato è quello estratto dal bollettino più recente ancora valido; in assenza di bollettini validi la pagina non stima un livello.
          </footer>
        </div>
      </main>
    </>
  );
}
