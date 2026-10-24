"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Layers, RefreshCcw, Satellite } from "lucide-react";
import { MapContainer, TileLayer } from "react-leaflet";
import RadarOverlayLayer from "@/components/RadarOverlayLayer";

const DPC_MAP_URL = "https://radar.protezionecivile.gov.it/";

const FALLBACK_PRODUCTS = [
  {
    id: "VMI",
    apiType: "VMI",
    label: "Massima intensita verticale",
    shortLabel: "VMI",
    unit: "dBZ",
    cadence: "5 min",
    wmsLayer: "radar:vmi",
    tileProduct: "VMI",
    description: "Massimo valore di riflettivita presente sulla verticale."
  },
  {
    id: "SRI",
    apiType: "SRI",
    label: "Intensita pioggia",
    shortLabel: "SRI",
    unit: "mm/h",
    cadence: "5 min",
    wmsLayer: "radar:sri",
    tileProduct: "SRI",
    description: "Stima radar dell'intensita di precipitazione al suolo."
  },
  {
    id: "SRT1",
    apiType: "SRT1",
    label: "Pioggia cumulata 1h",
    shortLabel: "SRT 1h",
    unit: "mm",
    cadence: "5 min",
    wmsLayer: "radar:srt_1",
    tileProduct: "SRT1",
    description: "Cumulata di precipitazione stimata nell'ultima ora."
  },
  {
    id: "CUM3",
    apiType: "CUM3",
    label: "Pioggia cumulata 3h",
    shortLabel: "CUM 3h",
    unit: "mm",
    cadence: "60 min",
    wmsLayer: "radar:cum3",
    tileProduct: "CUM3",
    description: "Cumulata da rete a terra interpolata su tre ore."
  },
  {
    id: "CUM6",
    apiType: "CUM6",
    label: "Pioggia cumulata 6h",
    shortLabel: "CUM 6h",
    unit: "mm",
    cadence: "60 min",
    wmsLayer: "radar:cum6",
    tileProduct: "CUM6",
    description: "Cumulata da rete a terra interpolata su sei ore."
  },
  {
    id: "CUM12",
    apiType: "CUM12",
    label: "Pioggia cumulata 12h",
    shortLabel: "CUM 12h",
    unit: "mm",
    cadence: "60 min",
    wmsLayer: "radar:cum12",
    tileProduct: "CUM12",
    description: "Cumulata da rete a terra interpolata su dodici ore."
  },
  {
    id: "CUM24",
    apiType: "CUM24",
    label: "Pioggia cumulata 24h",
    shortLabel: "CUM 24h",
    unit: "mm",
    cadence: "60 min",
    wmsLayer: "radar:cum24",
    tileProduct: "CUM24",
    description: "Cumulata da rete a terra interpolata su ventiquattro ore."
  },
  {
    id: "POH",
    apiType: "POH",
    label: "Probabilita grandine",
    shortLabel: "POH",
    unit: "%",
    cadence: "5 min",
    wmsLayer: "radar:poh",
    tileProduct: "POH",
    mapEnabled: false,
    description: "Probabilita di fenomeni grandinigeni; disponibile via REST e GeoTIFF, non nel tile cache WebP."
  },
  {
    id: "VIL",
    apiType: "VIL",
    label: "Acqua integrata verticale",
    shortLabel: "VIL",
    unit: "kg/m2",
    cadence: "5 min",
    wmsLayer: "radar:vil",
    tileProduct: "VIL",
    mapEnabled: false,
    description: "Stima della massa d'acqua liquida integrata in colonna; disponibile via REST e GeoTIFF, non nel tile cache WebP."
  },
  {
    id: "ETM",
    apiType: "ETM",
    label: "Echo top",
    shortLabel: "ETM",
    unit: "m",
    cadence: "5 min",
    wmsLayer: "radar:etm",
    tileProduct: "ETM",
    mapEnabled: false,
    description: "Altezza massima delle precipitazioni rilevate dal radar; disponibile via REST e GeoTIFF, non nel tile cache WebP."
  },
  {
    id: "IR_108",
    apiType: "IR_108",
    label: "Copertura nuvolosa",
    shortLabel: "IR 10.8",
    unit: "K",
    cadence: "5 min",
    wmsLayer: "radar:ir_108",
    tileProduct: "IR_108",
    description: "Prodotto satellitare derivato dal canale infrarosso 10.8."
  },
  {
    id: "TEMP",
    apiType: "TEMP",
    label: "Temperature",
    shortLabel: "TMP",
    unit: "C",
    cadence: "60 min",
    wmsLayer: null,
    tileProduct: "TEMP",
    mapEnabled: true,
    description: "Prodotto temperatura renderizzato dal tile cache WebP ufficiale Radar-DPC."
  },
  {
    id: "SITES",
    apiType: "SITES",
    label: "Siti radar",
    shortLabel: "SITES",
    unit: "stato",
    cadence: "5 min",
    wmsLayer: null,
    tileProduct: null,
    mapEnabled: false,
    description: "Ubicazione e stato operativo dei siti radar; gestito come layer vettoriale sulla mappa ufficiale DPC."
  }
];

const RADAR_LEGENDS = {
  SRI: {
    title: "Intensita pioggia SRI",
    unit: "mm/h",
    note: "Scala operativa indicativa per interpretare l'intensita istantanea della precipitazione.",
    items: [
      { label: "0.1 - 1", color: "#8fd3ff" },
      { label: "1 - 5", color: "#42d77d" },
      { label: "5 - 10", color: "#fff45a" },
      { label: "10 - 20", color: "#ff9f2f" },
      { label: "20 - 50", color: "#f0455d" },
      { label: "> 50", color: "#b225b7" }
    ]
  },
  SRT1: {
    title: "Cumulata pioggia 1h",
    unit: "mm",
    note: "Cumulata stimata nell'ultima ora.",
    items: [
      { label: "0 - 1", color: "#d7f2ff" },
      { label: "1 - 5", color: "#8fd3ff" },
      { label: "5 - 15", color: "#42d77d" },
      { label: "15 - 30", color: "#fff45a" },
      { label: "30 - 60", color: "#ff9f2f" },
      { label: "> 60", color: "#f0455d" }
    ]
  },
  CUM3: {
    title: "Cumulata pioggia 3h",
    unit: "mm",
    note: "Cumulata stimata sulle ultime 3 ore.",
    items: [
      { label: "0 - 5", color: "#d7f2ff" },
      { label: "5 - 15", color: "#8fd3ff" },
      { label: "15 - 30", color: "#42d77d" },
      { label: "30 - 50", color: "#fff45a" },
      { label: "50 - 80", color: "#ff9f2f" },
      { label: "> 80", color: "#f0455d" }
    ]
  },
  CUM6: {
    title: "Cumulata pioggia 6h",
    unit: "mm",
    note: "Cumulata stimata sulle ultime 6 ore.",
    items: [
      { label: "0 - 5", color: "#d7f2ff" },
      { label: "5 - 20", color: "#8fd3ff" },
      { label: "20 - 40", color: "#42d77d" },
      { label: "40 - 70", color: "#fff45a" },
      { label: "70 - 100", color: "#ff9f2f" },
      { label: "> 100", color: "#f0455d" }
    ]
  },
  CUM12: {
    title: "Cumulata pioggia 12h",
    unit: "mm",
    note: "Cumulata stimata sulle ultime 12 ore.",
    items: [
      { label: "0 - 10", color: "#d7f2ff" },
      { label: "10 - 30", color: "#8fd3ff" },
      { label: "30 - 60", color: "#42d77d" },
      { label: "60 - 100", color: "#fff45a" },
      { label: "100 - 150", color: "#ff9f2f" },
      { label: "> 150", color: "#f0455d" }
    ]
  },
  CUM24: {
    title: "Cumulata pioggia 24h",
    unit: "mm",
    note: "Cumulata stimata sulle ultime 24 ore.",
    items: [
      { label: "0 - 10", color: "#d7f2ff" },
      { label: "10 - 30", color: "#8fd3ff" },
      { label: "30 - 60", color: "#42d77d" },
      { label: "60 - 100", color: "#fff45a" },
      { label: "100 - 200", color: "#ff9f2f" },
      { label: "> 200", color: "#f0455d" }
    ]
  },
  VMI: {
    title: "Riflettivita VMI",
    unit: "dBZ",
    note: "Valori piu alti indicano nuclei convettivi e precipitazioni piu intense. Colori della palette ufficiale DPC.",
    items: [
      { label: "0 - 10", color: "#878787" },
      { label: "10 - 20", color: "#00fafa" },
      { label: "20 - 30", color: "#00fa00" },
      { label: "30 - 40", color: "#fafa00" },
      { label: "40 - 50", color: "#fa6400" },
      { label: "> 50", color: "#fa0000" }
    ]
  },
  TEMP: {
    title: "Temperatura",
    unit: "C",
    note: "Layer termico da rete a terra interpolata. Se resta vuoto, usa Test WMS diretto per verificare la disponibilita del layer DPC.",
    items: [
      { label: "< 0", color: "#7dd3fc" },
      { label: "0 - 10", color: "#38bdf8" },
      { label: "10 - 20", color: "#22c55e" },
      { label: "20 - 30", color: "#facc15" },
      { label: "30 - 38", color: "#fb923c" },
      { label: "> 38", color: "#ef4444" }
    ]
  },
  POH: {
    title: "Probabilita grandine",
    unit: "%",
    note: "Probabilita di grandine stimata dal prodotto POH.",
    items: [
      { label: "0 - 20", color: "#8fd3ff" },
      { label: "20 - 40", color: "#42d77d" },
      { label: "40 - 60", color: "#fff45a" },
      { label: "60 - 80", color: "#ff9f2f" },
      { label: "80 - 100", color: "#f0455d" }
    ]
  },
  VIL: {
    title: "Acqua integrata verticale",
    unit: "kg/m2",
    note: "Indicatore del contenuto d'acqua in colonna e della potenziale severita temporalesca.",
    items: [
      { label: "basso", color: "#8fd3ff" },
      { label: "moderato", color: "#42d77d" },
      { label: "alto", color: "#fff45a" },
      { label: "molto alto", color: "#ff9f2f" },
      { label: "estremo", color: "#f0455d" }
    ]
  },
  ETM: {
    title: "Echo top",
    unit: "m",
    note: "Altezza massima degli echi radar: utile per individuare celle convettive sviluppate.",
    items: [
      { label: "basso", color: "#8fd3ff" },
      { label: "medio", color: "#42d77d" },
      { label: "alto", color: "#fff45a" },
      { label: "molto alto", color: "#ff9f2f" },
      { label: "estremo", color: "#f0455d" }
    ]
  },
  IR_108: {
    title: "Canale IR 10.8",
    unit: "K",
    note: "Toni piu freddi indicano nubi piu alte e potenzialmente piu sviluppate.",
    items: [
      { label: "molto freddo", color: "#f8fafc" },
      { label: "freddo", color: "#93c5fd" },
      { label: "medio", color: "#64748b" },
      { label: "caldo", color: "#475569" }
    ]
  }
};

function formatDateTime(value) {
  if (!value) return "ultimo disponibile";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " ora " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function ToggleButton({ product, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"rounded-md border px-3 py-2 text-left text-xs transition " +
        (active
          ? "border-sky-300 bg-sky-400/20 text-sky-50"
          : "border-emergency-line bg-emergency-panel text-slate-400 hover:border-sky-400/60 hover:text-slate-100")}
    >
      <span className="block font-semibold">{product.shortLabel || product.id}</span>
      <span>{product.label}</span>
    </button>
  );
}

function RadarLegend({ product }) {
  const legend = RADAR_LEGENDS[product?.id] || RADAR_LEGENDS[product?.apiType];
  if (!legend) {
    return (
      <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Legenda</p>
        <p className="mt-2 text-sm text-slate-300">Legenda non disponibile per questo prodotto.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Legenda</p>
          <p className="mt-1 text-sm font-semibold text-slate-100">{legend.title}</p>
        </div>
        <span className="rounded-md border border-emergency-line bg-emergency-panel px-2 py-1 text-xs font-semibold text-slate-300">
          {legend.unit}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {legend.items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
            <span className="h-3 w-8 rounded-full border border-white/20" style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">{legend.note}</p>
    </div>
  );
}

export default function RadarDpcMap({ radarPayload, loading, selectedProduct, onProductChange, onRefresh }) {
  const products = useMemo(() => {
    const source = radarPayload?.products?.length ? radarPayload.products : FALLBACK_PRODUCTS;
    return source.filter((product) => product.mapEnabled !== false && (product.tileProduct || product.apiType));
  }, [radarPayload?.products]);
  const currentProduct = products.find((product) => product.id === selectedProduct || product.apiType === selectedProduct) || products[0];
  const [activeLayers, setActiveLayers] = useState([selectedProduct || "SRI"]);
  const lastProduct = radarPayload?.lastProduct;
  const payloadProductId = radarPayload?.product?.id || null;
  // Il campione del payload vale solo per il prodotto a cui si riferisce: usarlo per un altro
  // prodotto produrrebbe richieste a un timestamp inesistente (403 dal tile cache DPC).
  function tileTimestampFor(product) {
    if (!product || product.id !== payloadProductId) return null;
    return lastProduct?.productDate || lastProduct?.date || lastProduct?.wmsTime || null;
  }
  const errors = radarPayload?.errors || [];

  useEffect(() => {
    if (!currentProduct) return;
    setActiveLayers((current) => {
      if (current.length) return current;
      return [currentProduct.id];
    });
  }, [currentProduct]);

  function toggleLayer(productId) {
    setActiveLayers([productId]);
    onProductChange(productId);
  }

  const visibleLayers = products.filter((product) => activeLayers.includes(product.id));

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-emergency-line px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-3">
            <Satellite className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
            <div>
              <h2 className="section-title">Radar DPC</h2>
              <p className="muted">
                Mappa con tile WebP ufficiali Protezione Civile e prodotti selezionabili. Se il servizio non risponde, usa il collegamento alla mappa ufficiale.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-sky-400/60 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCcw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
              Aggiorna radar
            </button>
            <a
              href={DPC_MAP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-emerald-400/50 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20"
            >
              Mappa ufficiale DPC
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Layers className="h-4 w-4 text-sky-300" />
              Layer visualizzabili
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <ToggleButton
                  key={product.id}
                  product={product}
                  active={activeLayers.includes(product.id)}
                  onClick={() => toggleLayer(product.id)}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              La mappa usa le tile WebP ufficiali DPC. SRI puo risultare trasparente in assenza di precipitazioni.
              Le cumulate orarie e TEMP hanno un solo campione all&apos;ora, quindi la mappa resta ferma fino al successivo.
            </p>
          </div>

          <div className="h-[28rem] overflow-hidden rounded-lg border border-emergency-line bg-[#07101d] sm:h-[34rem]">
            <MapContainer center={[43.77, 11.25]} zoom={8} minZoom={6} maxZoom={12} scrollWheelZoom className="dpc-radar-map h-full w-full">
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="dpc-radar-basemap"
              />
              {visibleLayers.map((product, index) => {
                const timestamp = tileTimestampFor(product);
                if (!timestamp) return null;
                return (
                  <RadarOverlayLayer
                    key={product.id + "-" + timestamp}
                    product={product}
                    timestamp={timestamp}
                    opacity={index === visibleLayers.length - 1 ? 0.92 : 0.55}
                  />
                );
              })}
            </MapContainer>
          </div>

          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
            <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
              <div>
                <p className="uppercase text-slate-500">REST ultimo prodotto</p>
                <p className="mt-1 font-semibold text-slate-100">{formatDateTime(lastProduct?.date)}</p>
              </div>
              <div>
                <p className="uppercase text-slate-500">Layer attivi</p>
                <p className="mt-1 font-semibold text-slate-100">{visibleLayers.map((product) => product.shortLabel || product.id).join(", ")}</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Prodotto selezionato</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{currentProduct?.label || "Radar DPC"}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{currentProduct?.description || "Prodotto Radar-DPC."}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Cadenza</p>
                <p className="mt-1 font-semibold text-slate-100">{currentProduct?.cadence || "n.d."}</p>
              </div>
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Unita</p>
                <p className="mt-1 font-semibold text-slate-100">{currentProduct?.unit || "n.d."}</p>
              </div>
              <div className="col-span-2 rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Tile cache</p>
                <p className="mt-1 font-semibold text-slate-100">{currentProduct?.tileProduct || "n.d."}</p>
              </div>
            </div>
          </div>

          <RadarLegend product={currentProduct} />

          {!!errors.length && (
            <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 p-4 text-xs leading-5 text-orange-100">
              {errors.map((error) => (
                <p key={error.source + error.message}>{error.source}: {error.message}</p>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-emergency-yellow/40 bg-emergency-yellow/10 p-4 text-xs leading-5 text-yellow-100">
            I prodotti Radar-DPC sono informativi e non validati automaticamente in tempo reale. Per decisioni operative resta centrale il bollettino ufficiale di allerta e il monitoraggio CFR.
          </div>
        </aside>
      </div>
    </section>
  );
}
