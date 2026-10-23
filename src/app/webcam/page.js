"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, ExternalLink, Filter, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import AppNav from "@/components/AppNav";
import webcamCatalog from "@/data/webcams.json";

const STATUS_REFRESH_MS = 5 * 60 * 1000;
const FRAME_REFRESH_MS = Number(webcamCatalog.refreshSeconds || 120) * 1000;
const CATEGORY_LABELS = {
  all: "Tutte le webcam",
  "centro-storico": "Centro storico",
  "fiume-centro": "Arno e centro",
  "appennino-neve": "Appennino e neve",
  "a1-autostrada": "A1 Arezzo-Bologna"
};

function formatDateTime(value) {
  if (!value) return "in attesa";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " ora " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function getStatusLabel(status) {
  if (!status) return { label: "da verificare", className: "border-slate-600 bg-slate-600/10 text-slate-300", Icon: Wifi };
  if (status.online) return { label: "online", className: "border-emergency-green/50 bg-emergency-green/10 text-green-100", Icon: Wifi };
  return { label: "non raggiungibile", className: "border-emergency-orange/50 bg-emergency-orange/10 text-orange-100", Icon: WifiOff };
}

function WebcamCard({ webcam, status, refreshKey }) {
  const statusMeta = getStatusLabel(status);
  const StatusIcon = statusMeta.Icon;
  const canEmbed = webcam.embedMode === "iframe" && webcam.embedUrl;
  const canShowImage = webcam.embedMode === "image" && (webcam.previewUrl || webcam.embedUrl);
  const canShowVideo = webcam.embedMode === "video" && webcam.embedUrl;
  const frameSrc = canEmbed
    ? webcam.embedUrl + (webcam.embedUrl.includes("?") ? "&" : "?") + "dashboardRefresh=" + refreshKey
    : null;
  const imageSrc = canShowImage
    ? (webcam.previewUrl || webcam.embedUrl) + ((webcam.previewUrl || webcam.embedUrl).includes("?") ? "&" : "?") + "dashboardRefresh=" + refreshKey
    : null;
  const videoSrc = canShowVideo
    ? webcam.embedUrl + (webcam.embedUrl.includes("?") ? "&" : "?") + "dashboardRefresh=" + refreshKey
    : null;

  return (
    <article className="overflow-hidden rounded-lg border border-emergency-line bg-emergency-panel2">
      <div className="flex items-start justify-between gap-3 border-b border-emergency-line px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-100">{webcam.title}</h2>
          <p className="mt-1 truncate text-xs text-slate-400">{webcam.area} - {webcam.provider}</p>
        </div>
        <span
          className={"inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs " + statusMeta.className}
          title={status ? "Controllo: " + status.mode + " - " + status.checkedUrl + (status.contentType ? " (" + status.contentType + ")" : "") : "Nessun controllo effettuato"}
        >
          <StatusIcon className="h-3.5 w-3.5" />
          {statusMeta.label}
        </span>
      </div>

      <div className="relative aspect-video bg-slate-950">
        {canEmbed ? (
          <iframe
            key={frameSrc}
            src={frameSrc}
            title={webcam.title}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-full w-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
          />
        ) : canShowImage ? (
          <a
            href={webcam.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="group block h-full w-full"
            aria-label={"Apri live " + webcam.title}
          >
            {/* Skyline fornisce snapshot remoti aggiornati; next/image richiederebbe configurazione dominio per ogni provider. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={imageSrc}
              src={imageSrc}
              alt={webcam.title + " live preview"}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-2 rounded-md border border-sky-300/50 bg-slate-950/80 px-3 py-2 text-xs font-semibold text-sky-100 shadow-lg">
              Apri live
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </a>
        ) : canShowVideo ? (
          <video
            key={videoSrc}
            className="h-full w-full object-cover"
            controls
            muted
            playsInline
            preload="metadata"
            poster={webcam.previewUrl || undefined}
          >
            <source src={videoSrc} type={webcam.videoType || "video/mp4"} />
          </video>
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <div className="rounded-full border border-sky-400/40 bg-sky-400/10 p-4 text-sky-200">
              <Camera className="h-8 w-8" />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-100">Live pubblica non incorporabile</p>
            <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">
              Il provider consente la visione senza login sulla pagina ufficiale, ma blocca l&apos;apertura automatica dentro la dashboard.
            </p>
            <a
              href={webcam.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
            >
              Apri live
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-3 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p>{webcam.municipality}</p>
          <p className="mt-0.5">Ultimo controllo: {formatDateTime(status?.checkedAt)}</p>
        </div>
        <a
          href={webcam.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 font-medium text-sky-100 hover:bg-sky-400/20"
        >
          Apri fonte
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

export default function WebcamPage() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [statusPayload, setStatusPayload] = useState(null);
  const [checking, setChecking] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now());

  const categories = useMemo(() => {
    const values = [...new Set((webcamCatalog.items || []).map((item) => item.category))];
    return ["all", ...values];
  }, []);

  const statusById = useMemo(
    () => new Map((statusPayload?.results || []).map((item) => [item.id, item])),
    [statusPayload]
  );

  const visibleWebcams = useMemo(
    () => (webcamCatalog.items || []).filter((item) => selectedCategory === "all" || item.category === selectedCategory),
    [selectedCategory]
  );

  async function checkAvailability() {
    setChecking(true);
    try {
      const response = await fetch("/api/webcams/status", { cache: "no-store" });
      const payload = await response.json();
      setStatusPayload(payload);
    } catch {
      setStatusPayload({
        fetchedAt: new Date().toISOString(),
        total: webcamCatalog.items.length,
        online: 0,
        results: []
      });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    checkAvailability();
    const timer = window.setInterval(checkAvailability, STATUS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey(Date.now()), FRAME_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <header className="panel p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Provincia di Firenze</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Webcam pubbliche</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  Catalogo di webcam consultabili senza abbonamento o registrazione, con controllo automatico di disponibilita. Anteprime e video incorporabili vengono mostrati in pagina; il click apre la live completa quando disponibile.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:min-w-[20rem]">
                <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Catalogo</p>
                  <p className="mt-1 text-xl font-semibold text-white">{webcamCatalog.items.length}</p>
                </div>
                <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Online</p>
                  <p className="mt-1 text-xl font-semibold text-white">{statusPayload?.online ?? "..."}</p>
                </div>
              </div>
            </div>
          </header>

          <section className="panel p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="flex flex-col gap-1 sm:min-w-[18rem]">
                <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Filter className="h-4 w-4 text-sky-300" />
                  Area
                </span>
                <select
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {CATEGORY_LABELS[category] || category}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => {
                  setRefreshKey(Date.now());
                  checkAvailability();
                }}
                disabled={checking}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sky-400/60 bg-sky-400/10 px-4 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCcw className={"h-4 w-4 " + (checking ? "animate-spin" : "")} />
                Aggiorna
              </button>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            {visibleWebcams.map((webcam) => (
              <WebcamCard
                key={webcam.id}
                webcam={webcam}
                status={statusById.get(webcam.id)}
                refreshKey={refreshKey}
              />
            ))}
          </section>

          <div className="rounded-lg border border-emergency-line bg-emergency-panel/70 px-4 py-3 text-xs text-slate-400">
            La pagina supporta immagini SkylineWebcams e video MP4 diretti Autostrade: quando una sorgente non espone stream incorporabili, resta disponibile il link alla fonte pubblica.
          </div>

          <footer className="pb-6 text-xs text-slate-500">
            Fonti webcam: pagine pubbliche dei rispettivi provider. Ultimo controllo disponibilita: {formatDateTime(statusPayload?.fetchedAt)}.
          </footer>
        </div>
      </main>
    </>
  );
}
