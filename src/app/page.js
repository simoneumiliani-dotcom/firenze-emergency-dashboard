"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CloudRain,
  Database,
  Droplets,
  Gauge,
  MapPin,
  RefreshCcw,
  Snowflake,
  Thermometer,
  Waves,
  Wind
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import PdfParser from "@/components/PdfParser";
import {
  CHART_COLORS,
  ALL_STATIONS,
  DEFAULT_CHART_STATION_IDS,
  DEFAULT_PANEL_CONFIGS,
  MEASUREMENT_TYPES,
  STATIONS_BY_TYPE,
  getStationPosition,
  getMeasurementMeta
} from "@/lib/cfrStations";

const MapDashboard = dynamic(() => import("@/components/MapDashboard"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[28rem] items-center justify-center rounded-lg border border-emergency-line bg-emergency-panel text-slate-300">
      Caricamento mappa...
    </div>
  )
});

const ICONS = {
  rain: CloudRain,
  water: Waves,
  temperature: Thermometer,
  wind: Wind,
  humidity: Droplets,
  snow: Snowflake
};

const WEBCAMS = [
  { id: "firenze-centro", title: "Firenze Centro", area: "Arno e centro storico", imageUrl: "https://images.unsplash.com/photo-1541370976299-4d24ebbc9077?auto=format&fit=crop&w=900&q=80" },
  { id: "ponte-vecchio", title: "Ponte Vecchio", area: "Vista urbana Arno", imageUrl: "https://images.unsplash.com/photo-1551621955-fa07d5389353?auto=format&fit=crop&w=900&q=80" },
  { id: "mugello", title: "Mugello", area: "Appennino fiorentino", imageUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80" },
  { id: "consuma", title: "Passo della Consuma", area: "Viabilita montana", imageUrl: "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=900&q=80" },
  { id: "valdarno", title: "Valdarno", area: "Bacino Arno", imageUrl: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=80" },
  { id: "bisenzio", title: "Ombrone Bisenzio", area: "Nord ovest provincia", imageUrl: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80" }
];

const ALERT_STYLE = {
  Verde: "border-emergency-green/60 bg-emergency-green/10 text-emergency-green",
  Giallo: "border-emergency-yellow/70 bg-emergency-yellow/10 text-emergency-yellow",
  Arancione: "border-emergency-orange/70 bg-emergency-orange/10 text-emergency-orange",
  Rosso: "border-emergency-red/70 bg-emergency-red/10 text-emergency-red"
};

function buildFallbackMeasurements() {
  return Object.fromEntries(Object.entries(STATIONS_BY_TYPE).map(([type, stations]) => [
    type,
    stations.map((station) => {
      return {
        ...station,
        ...getStationPosition(station.id),
        value: null,
        unit: MEASUREMENT_TYPES[type].unit,
        trend: null,
        updatedAt: null,
        warning: null,
        danger: null,
        history: undefined,
        unavailable: true,
        real: false
      };
    })
  ]));
}

function buildHydroHistory(value) {
  return ["-5h", "-4h", "-3h", "-2h", "-1h", "Ora"].map((time, index) => ({
    time,
    value: Number(Math.max(0, value + Math.sin(index * 0.9) * 0.16).toFixed(2)),
    warning: Number((value + 0.8).toFixed(2))
  }));
}

function normalizeObservationData(payload) {
  const fallback = buildFallbackMeasurements();
  return {
    measurements: payload?.measurements || fallback,
    source: payload?.source || "CFR Toscana",
    primarySource: payload?.primarySource || "CFR Toscana",
    fallbackSource: payload?.fallbackSource || null,
    fetchedAt: payload?.fetchedAt || null,
    cache: payload?.cache || null,
    meteoHub: payload?.meteoHub || null,
    openMeteoFallbackCount: payload?.openMeteoFallbackCount || 0,
    warning: payload?.warning || null
  };
}

function mergeObservationData(base, incoming) {
  const next = normalizeObservationData(incoming);
  const measurements = Object.fromEntries(Object.entries(base.measurements).map(([type, stations]) => [
    type,
    stations.map((station) => {
      const realtime = next.measurements[type]?.find((candidate) => candidate.id === station.id);
      if (!realtime || realtime.value === null || realtime.value === undefined) return station;
      return { ...station, ...realtime };
    })
  ]));

  return {
    ...base,
    ...next,
    measurements,
    cache: next.cache || base.cache,
    warning: next.warning || base.warning
  };
}

function buildSelectedObservationQuery(panelConfigs, chartStationIds) {
  const items = new Set();
  panelConfigs.forEach((config) => {
    config.stationIds.forEach((stationId) => {
      if (stationId) items.add(config.type + ":" + stationId);
    });
  });
  chartStationIds.forEach((stationId) => {
    if (stationId) items.add("hydrometry:" + stationId);
  });
  return [...items].join(",");
}

const CACHE_WARMUP_TYPES = ["pluviometry", "hydrometry", "thermometry", "anemometry", "hygrometry"];
const CACHE_WARMUP_BATCH_SIZE = 18;

function buildCacheWarmupJobs() {
  return CACHE_WARMUP_TYPES.flatMap((type) => {
    const stationCount = STATIONS_BY_TYPE[type]?.length || 0;
    const totalBatches = Math.max(1, Math.ceil(stationCount / CACHE_WARMUP_BATCH_SIZE));
    return Array.from({ length: totalBatches }, (_, batch) => ({
      type,
      batch,
      batchSize: CACHE_WARMUP_BATCH_SIZE,
      label: MEASUREMENT_TYPES[type]?.label || type
    }));
  });
}

function normalizeWeatherData(payload) {
  return {
    source: payload?.source || "Open-Meteo",
    fetchedAt: payload?.fetchedAt || null,
    warning: payload?.warning || null,
    locations: payload?.locations || []
  };
}

function normalizeMeteoHubData(payload) {
  return {
    source: payload?.source || "MeteoHub",
    connected: Boolean(payload?.connected),
    authenticated: Boolean(payload?.authenticated),
    fetchedAt: payload?.fetchedAt || null,
    warning: payload?.warning || null,
    note: payload?.note || null,
    requests: payload?.requests || []
  };
}

function getStationStatus(station) {
  const value = Number(station.value);
  const danger = Number(station.danger);
  const warning = Number(station.warning);
  if (station.value === null || station.value === undefined) return "Verde";
  if (Number.isFinite(value) && Number.isFinite(danger) && value >= danger) return "Rosso";
  if (Number.isFinite(value) && Number.isFinite(warning) && value >= warning) return "Giallo";
  return "Verde";
}

function TrendIcon({ trend }) {
  if (!trend) return <span className="text-slate-500">-</span>;
  if (trend === "up") return <ArrowUp className="h-4 w-4 text-emergency-orange" aria-label="in aumento" />;
  if (trend === "down") return <ArrowDown className="h-4 w-4 text-sky-300" aria-label="in diminuzione" />;
  return <Activity className="h-4 w-4 text-slate-400" aria-label="stabile" />;
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        <Icon className="h-5 w-5 text-sky-300" />
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-100">{value}</p>
    </div>
  );
}

// Sintesi operativa del catalogo usato da pannelli, mappa e fallback su coordinate.
function MeteoHubStationOverview({ measurements, source, fetchedAt, cache, warmup, onWarmCache }) {
  const sourceLabel = source || "CFR Toscana";
  const availableCounts = Object.fromEntries(
    Object.entries(MEASUREMENT_TYPES).map(([type]) => [
      type,
      (measurements[type] || []).filter((station) => station.value !== null && station.value !== undefined).length
    ])
  );

  return (
    <section className="panel p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10">
            <Database className="h-5 w-5 text-sky-200" />
          </div>
          <div>
            <h2 className="section-title">Stazioni CFR Toscana</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              La dashboard usa CFR Toscana come fonte primaria per le stazioni, con Open-Meteo solo come supporto dove il dato ufficiale non e disponibile.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:min-w-[28rem]">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Catalogo</p>
            <p className="mt-1 text-xl font-semibold text-white">{ALL_STATIONS.length}</p>
          </div>
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Fonte primaria</p>
            <p className="mt-1 truncate font-semibold text-sky-100">{sourceLabel}</p>
          </div>
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Cache</p>
            <p className="mt-1 font-semibold text-slate-100">{cache?.persistent ? "KV" : cache?.mode || (cache?.hit ? "hit" : "refresh")}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-sky-100">Aggiornamento cache CFR</p>
          <p className="mt-1 text-xs text-slate-400">
            {warmup?.running
              ? "Batch " + warmup.done + "/" + warmup.total + (warmup.current ? " - " + warmup.current : "")
              : warmup?.message || "Scarica i batch CFR e li fonde nella cache persistente."}
          </p>
          {warmup?.error && <p className="mt-1 text-xs text-emergency-orange">{warmup.error}</p>}
        </div>
        <button
          type="button"
          onClick={onWarmCache}
          disabled={warmup?.running}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-sky-400/50 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:border-sky-300 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCcw className={"h-4 w-4 " + (warmup?.running ? "animate-spin" : "")} />
          {warmup?.running ? "Aggiornamento..." : "Aggiorna cache CFR"}
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        {Object.entries(MEASUREMENT_TYPES).map(([type, meta]) => (
          <div key={type} className="rounded-lg border border-emergency-line bg-black/15 px-3 py-2">
            <p className="text-xs text-slate-400">{meta.label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">
              {STATIONS_BY_TYPE[type]?.length || 0} stazioni
              <span className="ml-2 text-xs font-normal text-sky-200">
                {availableCounts[type]} con dato
              </span>
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <MapPin className="h-4 w-4 text-sky-300" />
        <span>Coordinate da catalogo stazioni locale allineato a CFR Toscana.</span>
        {fetchedAt && <span>Ultimo aggiornamento dati: {fetchedAt}</span>}
      </div>
    </section>
  );
}

function StationSelect({ value, onChange, options, label }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
      >
        {options.map((station) => (
          <option key={station.id} value={station.id}>{station.id} - {station.name}</option>
        ))}
      </select>
    </label>
  );
}

function MeasurementPanel({ index, config, onChange, measurements }) {
  const meta = getMeasurementMeta(config.type);
  const Icon = ICONS[meta.icon] || Gauge;
  const catalog = STATIONS_BY_TYPE[config.type] || [];
  const rows = config.stationIds
    .map((stationId) => measurements[config.type]?.find((station) => station.id === stationId))
    .filter(Boolean);

  function updateStation(slot, stationId) {
    const nextIds = [...config.stationIds];
    nextIds[slot] = stationId;
    onChange({ ...config, stationIds: nextIds });
  }

  function updateType(type) {
    const nextCatalog = STATIONS_BY_TYPE[type] || [];
    onChange({ ...config, type, stationIds: nextCatalog.slice(0, 3).map((station) => station.id) });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-emergency-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Dashboard CFR {index + 1}</h2>
            <p className="text-xs text-slate-400">{catalog.length} stazioni disponibili per {meta.label}</p>
          </div>
        </div>
        <select
          value={config.type}
          onChange={(event) => updateType(event.target.value)}
          className="rounded-md border border-emergency-line bg-emergency-panel2 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400"
        >
          {Object.entries(MEASUREMENT_TYPES).map(([type, item]) => (
            <option key={type} value={type}>{item.label}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-3">
        {[0, 1, 2].map((slot) => (
          <StationSelect
            key={slot}
            value={config.stationIds[slot] || catalog[slot]?.id || ""}
            onChange={(stationId) => updateStation(slot, stationId)}
            options={catalog}
            label={`Stazione ${slot + 1}`}
          />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-emergency-line text-sm">
          <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Stazione</th>
              <th className="px-4 py-3">{meta.valueLabel}</th>
              <th className="px-4 py-3">Trend</th>
              <th className="px-4 py-3">Fonte</th>
              <th className="px-4 py-3">Aggiornamento</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emergency-line">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/[0.03]">
                <td className="whitespace-nowrap px-4 py-3 text-slate-400">{row.id}</td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-100">{row.name}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-200">{row.value ?? "n.d."} {row.unit}</td>
                <td className="px-4 py-3"><TrendIcon trend={row.trend} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                  {row.provider || "n.d."}
                  {row.modelled ? <span className="ml-1 text-xs text-sky-300">(coord.)</span> : null}
                  {row.unavailable ? <span className="ml-1 text-xs text-orange-200">(in attesa)</span> : null}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-400">{row.updatedAt || "n.d."}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiverChart({ stations, selectedIds, onSelectedIdsChange }) {
  const selectedStations = selectedIds
    .map((id) => stations.find((station) => station.id === id))
    .filter(Boolean);

  const chartData = useMemo(() => {
    const points = selectedStations[0]?.history || [];
    return points.map((point, index) => {
      const row = { time: point.time };
      selectedStations.forEach((station) => {
        row[station.id] = station.history?.[index]?.value ?? null;
        row[`${station.id}-warning`] = station.history?.[index]?.warning ?? station.warning;
      });
      return row;
    });
  }, [selectedStations]);

  function toggleStation(stationId) {
    if (selectedIds.includes(stationId)) {
      onSelectedIdsChange(selectedIds.filter((id) => id !== stationId));
      return;
    }
    onSelectedIdsChange([...selectedIds, stationId]);
  }

  return (
    <section className="panel p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="section-title">Andamento idrometrico</h2>
          <p className="muted">Selezione manuale da stazioni CFR idrometriche. Ogni linea e ogni soglia hanno colore dedicato.</p>
        </div>
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) toggleStation(event.target.value);
          }}
          className="rounded-md border border-emergency-line bg-emergency-panel2 px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
        >
          <option value="">Aggiungi/rimuovi stazione</option>
          {stations.map((station) => (
            <option key={station.id} value={station.id}>
              {selectedIds.includes(station.id) ? "[x] " : ""}{station.id} - {station.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {selectedStations.map((station, index) => (
          <button
            key={station.id}
            type="button"
            onClick={() => toggleStation(station.id)}
            className="rounded-md border px-2.5 py-1 text-xs text-slate-100"
            style={{ borderColor: CHART_COLORS[index % CHART_COLORS.length], background: `${CHART_COLORS[index % CHART_COLORS.length]}22` }}
          >
            {station.name}
          </button>
        ))}
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit="m" />
            <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
            <Legend />
            {selectedStations.map((station, index) => {
              const color = CHART_COLORS[index % CHART_COLORS.length];
              return (
                <Line key={station.id} type="monotone" dataKey={station.id} name={station.name} stroke={color} strokeWidth={2} dot={false} />
              );
            })}
            {selectedStations.map((station, index) => {
              const color = CHART_COLORS[index % CHART_COLORS.length];
              return (
                <Line key={`${station.id}-warning`} type="monotone" dataKey={`${station.id}-warning`} name={`Soglia ${station.name}`} stroke={color} strokeDasharray="6 6" dot={false} />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function WebcamGrid() {
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setReloadKey(Date.now());
    const timer = window.setInterval(() => setReloadKey(Date.now()), 120000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="panel p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Webcam strategiche</h2>
          <p className="muted">Lista modificabile nel codice con refresh automatico ogni 2 minuti.</p>
        </div>
        <RefreshCcw className="h-5 w-5 text-sky-300" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {WEBCAMS.map((webcam) => (
          <WebcamCard key={webcam.id} webcam={webcam} reloadKey={reloadKey} />
        ))}
      </div>
    </section>
  );
}

function WeatherForecastPanel({ weatherData }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-emergency-line px-4 py-3">
        <div>
          <h2 className="section-title">Previsioni orarie Open-Meteo</h2>
          <p className="muted">Pioggia, vento, temperatura e umidita per Firenze e comuni limitrofi.</p>
        </div>
        <CloudRain className="h-5 w-5 text-sky-300" />
      </div>
      {weatherData.warning ? (
        <div className="px-4 py-3 text-sm text-orange-100">{weatherData.warning}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-emergency-line text-sm">
            <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Comune</th>
                <th className="px-4 py-3">Pioggia</th>
                <th className="px-4 py-3">Vento</th>
                <th className="px-4 py-3">Temperatura</th>
                <th className="px-4 py-3">Umidita</th>
                <th className="px-4 py-3">Ora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emergency-line">
              {weatherData.locations.map((location) => (
                <tr key={location.id} className="hover:bg-white/[0.03]">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-100">{location.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-200">{location.current.precipitation} mm</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-200">{location.current.windSpeed} km/h</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-200">{location.current.temperature} C</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-200">{location.current.humidity}%</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-400">{location.current.time?.slice(11, 16) || "n.d."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MeteoHubPanel({ meteoHubData }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-emergency-line px-4 py-3">
        <div>
          <h2 className="section-title">MeteoHub Agenzia ItaliaMeteo</h2>
          <p className="muted">Stato portale, autenticazione e richieste di estrazione dati configurate.</p>
        </div>
        <CloudRain className="h-5 w-5 text-sky-300" />
      </div>
      <div className="p-4">
        <div className={`rounded-lg border px-3 py-2 text-sm ${meteoHubData.connected ? "border-emergency-green/50 bg-emergency-green/10 text-green-100" : "border-emergency-orange/50 bg-emergency-orange/10 text-orange-100"}`}>
          {meteoHubData.connected ? "Connessione MeteoHub autenticata." : meteoHubData.warning || "MeteoHub non collegato."}
        </div>
        {meteoHubData.note && <p className="mt-3 text-sm text-slate-400">{meteoHubData.note}</p>}
        {!!meteoHubData.requests.length && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-emergency-line text-sm">
              <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Richiesta</th>
                  <th className="px-3 py-2">Stato</th>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emergency-line">
                {meteoHubData.requests.map((request, index) => (
                  <tr key={request.id || index}>
                    <td className="px-3 py-2 text-slate-100">{request.name}</td>
                    <td className="px-3 py-2 text-slate-300">{request.status}</td>
                    <td className="px-3 py-2 text-slate-400">{Array.isArray(request.dataset) ? request.dataset.join(", ") : request.dataset || "n.d."}</td>
                    <td className="px-3 py-2 text-slate-400">{request.fileoutput || "n.d."}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function WebcamCard({ webcam, reloadKey }) {
  const [failed, setFailed] = useState(false);
  const separator = webcam.imageUrl.includes("?") ? "&" : "?";
  const src = `${webcam.imageUrl}${separator}t=${reloadKey}`;

  return (
    <article className="overflow-hidden rounded-lg border border-emergency-line bg-emergency-panel2">
      <div className="aspect-video bg-slate-900">
        {failed ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-slate-400">Webcam non disponibile</div>
        ) : (
          <img src={src} alt={webcam.title} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        )}
      </div>
      <div className="p-3">
        <h3 className="truncate text-sm font-semibold text-slate-100">{webcam.title}</h3>
        <p className="truncate text-xs text-slate-400">{webcam.area}</p>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const [alert, setAlert] = useState({ level: "Verde", matches: [], fileName: null });
  const [observationData, setObservationData] = useState(normalizeObservationData(null));
  const [weatherData, setWeatherData] = useState(normalizeWeatherData(null));
  const [meteoHubData, setMeteoHubData] = useState(normalizeMeteoHubData(null));
  const [loading, setLoading] = useState(true);
  const [cacheWarmup, setCacheWarmup] = useState({ running: false, done: 0, total: 0, current: null, message: null, error: null });
  const [panelConfigs, setPanelConfigs] = useState(DEFAULT_PANEL_CONFIGS);
  const [chartStationIds, setChartStationIds] = useState(DEFAULT_CHART_STATION_IDS);

  async function loadObservationData() {
    setLoading(true);
    try {
      const response = await fetch("/api/observations", { cache: "default" });
      const payload = await response.json();
      setObservationData((current) => mergeObservationData(current, payload));
    } catch (error) {
      setObservationData(normalizeObservationData({ warning: "CFR Toscana non raggiungibile. Open-Meteo viene usato solo dove disponibile come fallback." }));
    } finally {
      setLoading(false);
    }
  }

  async function loadWeatherData() {
    try {
      const response = await fetch("/api/weather-data", { cache: "no-store" });
      const payload = await response.json();
      setWeatherData(normalizeWeatherData(payload));
    } catch (error) {
      setWeatherData(normalizeWeatherData({ warning: "Fonte Open-Meteo non raggiungibile." }));
    }
  }

  async function loadMeteoHubData() {
    try {
      const response = await fetch("/api/meteohub-data", { cache: "no-store" });
      const payload = await response.json();
      setMeteoHubData(normalizeMeteoHubData(payload));
    } catch (error) {
      setMeteoHubData(normalizeMeteoHubData({ warning: "MeteoHub non raggiungibile." }));
    }
  }

  const selectedObservationQuery = useMemo(() => buildSelectedObservationQuery(panelConfigs, chartStationIds), [panelConfigs, chartStationIds]);

  async function loadSelectedObservationData(selectedQuery) {
    if (!selectedQuery) return;
    try {
      const response = await fetch("/api/observations?selected=" + encodeURIComponent(selectedQuery), { cache: "no-store" });
      const payload = await response.json();
      setObservationData((current) => mergeObservationData(current, payload));
    } catch {
      setObservationData((current) => ({
        ...current,
        warning: "Realtime CFR non raggiungibile per le stazioni selezionate."
      }));
    }
  }

  async function warmObservationCache() {
    const jobs = buildCacheWarmupJobs();
    setCacheWarmup({ running: true, done: 0, total: jobs.length, current: null, message: null, error: null });

    try {
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        setCacheWarmup((current) => ({
          ...current,
          current: job.label + " batch " + (job.batch + 1),
          done: index
        }));

        const params = new URLSearchParams({
          type: job.type,
          batch: String(job.batch),
          batchSize: String(job.batchSize)
        });
        const response = await fetch("/api/sync-observations?" + params.toString(), { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Batch CFR non riuscito");

        setCacheWarmup((current) => ({
          ...current,
          done: index + 1,
          message: "Ultimo batch: " + job.label + " (" + (payload.populatedStations || 0) + " dati letti)"
        }));
      }

      await loadObservationData();
      await loadSelectedObservationData(selectedObservationQuery);
      setCacheWarmup({ running: false, done: jobs.length, total: jobs.length, current: null, message: "Cache CFR aggiornata. Ricarico completato.", error: null });
    } catch (error) {
      setCacheWarmup((current) => ({
        ...current,
        running: false,
        error: error instanceof Error ? error.message : "Aggiornamento cache interrotto"
      }));
    }
  }

  useEffect(() => {
    loadObservationData();
    loadWeatherData();
    loadMeteoHubData();
  }, []);

  useEffect(() => {
    loadSelectedObservationData(selectedObservationQuery);
  }, [selectedObservationQuery]);

  const hydrometryStations = observationData.measurements.hydrometry || [];
  const highestHydroStatus = useMemo(() => {
    if (hydrometryStations.some((station) => getStationStatus(station) === "Rosso")) return "Rosso";
    if (hydrometryStations.some((station) => getStationStatus(station) === "Giallo")) return "Giallo";
    return "Verde";
  }, [hydrometryStations]);

  const visibleAlert = alert.level !== "Verde" ? alert.level : highestHydroStatus;
  const mapStations = Object.values(observationData.measurements).flat();

  return (
    <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-emergency-line bg-emergency-panel/80 p-4 shadow-glow md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Provincia di Firenze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white md:text-3xl">Dashboard CFR Toscana allerta meteo ed emergenze</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Monitoraggio su stazioni CFR Toscana con cache programmata e fallback Open-Meteo visibile per pluviometria, termometria, anemometria, igrometria e nivometria.</p>
          </div>
          <div className={`rounded-lg border px-4 py-3 ${ALERT_STYLE[visibleAlert]}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-medium">Allerta attiva</span>
            </div>
            <p className="mt-1 text-2xl font-semibold">{visibleAlert}</p>
          </div>
        </header>

        <PdfParser onAlertDetected={setAlert} />

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Object.entries(MEASUREMENT_TYPES).map(([type, meta]) => {
            const Icon = ICONS[meta.icon] || Gauge;
            return <StatCard key={type} icon={Icon} label={meta.label} value={loading ? "..." : observationData.measurements[type]?.length || 0} />;
          })}
        </section>

        <MeteoHubStationOverview
          measurements={observationData.measurements}
          source={observationData.source}
          fetchedAt={observationData.fetchedAt}
          cache={observationData.cache}
          warmup={cacheWarmup}
          onWarmCache={warmObservationCache}
        />

        {observationData.warning && (
          <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{observationData.warning}</div>
        )}

        <MapDashboard stations={mapStations} />

        <section className="grid gap-5 xl:grid-cols-2">
          {panelConfigs.map((config, index) => (
            <MeasurementPanel
              key={config.id}
              index={index}
              config={config}
              measurements={observationData.measurements}
              onChange={(nextConfig) => {
                setPanelConfigs((current) => current.map((item) => item.id === config.id ? nextConfig : item));
              }}
            />
          ))}
        </section>

        <RiverChart
          stations={hydrometryStations}
          selectedIds={chartStationIds}
          onSelectedIdsChange={setChartStationIds}
        />

        <WeatherForecastPanel weatherData={weatherData} />

        <MeteoHubPanel meteoHubData={meteoHubData} />

        <WebcamGrid />

        <footer className="pb-6 text-xs text-slate-500">
          Fonte osservazioni: {observationData.source}. Cache: {observationData.cache?.hit ? "hit" : "refresh"} {observationData.cache?.updatedAt || ""}. Meteo: {weatherData.source} {weatherData.fetchedAt || ""}.
        </footer>
      </div>
    </main>
  );
}
