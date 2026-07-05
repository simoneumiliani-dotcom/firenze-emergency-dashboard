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
  RefreshCcw,
  Snowflake,
  Thermometer,
  Waves,
  Wind,
  X
} from "lucide-react";
import PdfParser from "@/components/PdfParser";
import AppNav from "@/components/AppNav";
import {
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

const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

const ICONS = {
  rain: CloudRain,
  water: Waves,
  temperature: Thermometer,
  wind: Wind,
  humidity: Droplets,
  snow: Snowflake
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
  const measurements = payload?.measurements
    ? { ...payload.measurements, hydrometry: fallback.hydrometry }
    : fallback;
  return {
    measurements,
    source: payload?.source || "CFR Toscana",
    primarySource: payload?.primarySource || "CFR Toscana",
    fallbackSource: payload?.fallbackSource || null,
    fetchedAt: payload?.fetchedAt || null,
    cache: payload?.cache || null,
    meteoHub: payload?.meteoHub || null,
    openMeteoFallbackCount: payload?.openMeteoFallbackCount || 0,
    cfr: payload?.cfr || null,
    openMeteo: payload?.openMeteo || null,
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

function buildSelectedObservationQuery(panelConfigs) {
  const items = new Set();
  panelConfigs.forEach((config) => {
    if (config.type === "hydrometry") return;
    config.stationIds.forEach((stationId) => {
      if (stationId) items.add(config.type + ":" + stationId);
    });
  });
  return [...items].join(",");
}


const OPEN_METEO_CLIENT_TYPES = ["pluviometry", "thermometry", "anemometry", "hygrometry", "nivometry"];

function getOpenMeteoClientValue(payload, type) {
  const current = payload?.current || {};
  if (type === "pluviometry") return current.precipitation ?? null;
  if (type === "thermometry") return current.temperature_2m ?? null;
  if (type === "anemometry") return current.wind_speed_10m ?? null;
  if (type === "hygrometry") return current.relative_humidity_2m ?? null;
  if (type === "nivometry") {
    const hourly = payload?.hourly || {};
    const index = Array.isArray(hourly.time) && current.time ? hourly.time.indexOf(current.time) : -1;
    const rawValue = Array.isArray(hourly.snow_depth) ? hourly.snow_depth[index >= 0 ? index : 0] : 0;
    if (rawValue === null || rawValue === undefined) return 0;
    return payload?.hourly_units?.snow_depth === "m" ? Number((rawValue * 100).toFixed(1)) : rawValue;
  }
  return null;
}

function getOpenMeteoClientUrl(station) {
  const params = new URLSearchParams({
    latitude: String(station.lat),
    longitude: String(station.lng),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
    hourly: "snow_depth",
    timezone: "Europe/Rome",
    forecast_days: "1"
  });
  return "https://api.open-meteo.com/v1/forecast?" + params.toString();
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

function formatShortTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function normalizeHydrometryForDashboard(payload) {
  const realtimeByStation = new Map((payload?.realtimeMeasurements || []).map((row) => [row.station_id, row]));
  return (payload?.stations || []).map((station) => {
    const realtime = realtimeByStation.get(station.station_id);
    const value = realtime?.level_m;
    const numericValue = Number(value);
    const hasValue = Number.isFinite(numericValue);
    const warning = Number.isFinite(Number(realtime?.warning_m))
      ? Number(realtime.warning_m)
      : hasValue ? Number((numericValue + 0.8).toFixed(2)) : null;
    const danger = Number.isFinite(Number(realtime?.danger_m))
      ? Number(realtime.danger_m)
      : hasValue ? Number((numericValue + 1.4).toFixed(2)) : null;

    return {
      id: station.station_id,
      name: station.station_name,
      type: "hydrometry",
      lat: station.latitude,
      lng: station.longitude,
      value: hasValue ? numericValue : null,
      unit: MEASUREMENT_TYPES.hydrometry.unit,
      trend: realtime?.trend || null,
      updatedAt: formatShortTime(realtime?.measurement_time),
      warning,
      danger,
      history: hasValue ? buildHydroHistory(numericValue) : undefined,
      unavailable: !hasValue,
      provider: realtime ? "CFR Toscana" : "CFR Toscana (in attesa)",
      real: Boolean(realtime),
      extra: {
        riverName: station.river_name,
        basin: station.basin,
        flow: realtime?.flow_mc_s ?? null,
        delta_h1_m: realtime?.delta_h1_m ?? null,
        delta_h3_m: realtime?.delta_h3_m ?? null,
        delta_h6_m: realtime?.delta_h6_m ?? null,
        source_url: realtime?.source_url || station.source_url
      }
    };
  });
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

function formatSourceTimestamp(value) {
  if (!value) return "in attesa di aggiornamento";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { year: "numeric", month: "2-digit", day: "2-digit" }) + " ora " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function SourceStatusPanel({ observationData }) {
  const cfrUpdatedAt = observationData.cfr?.fetchedAt || observationData.fetchedAt;
  const openMeteoUpdatedAt = observationData.openMeteo?.fetchedAt || observationData.fetchedAt;

  return (
    <section className="panel p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10">
            <Database className="h-5 w-5 text-sky-200" />
          </div>
          <div>
            <h2 className="section-title">Fonti dati aggiornate</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Open Meteo costituisce la fonte primaria per pluviometria, termometria, anemometria, igrometria e nivometria. CFR Toscana resta la fonte primaria per idrometria. Aggiornamento automatico ogni 5 minuti.
            </p>
          </div>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:min-w-[34rem]">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">CFR Toscana</p>
            <p className="mt-1 font-semibold text-sky-100">Idrometria</p>
            <p className="mt-1 text-xs text-slate-400">Ultimo aggiornamento dati: {formatSourceTimestamp(cfrUpdatedAt)}</p>
          </div>
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Open Meteo</p>
            <p className="mt-1 font-semibold text-sky-100">Pluvio, termo, vento, umidita, neve</p>
            <p className="mt-1 text-xs text-slate-400">Ultimo aggiornamento dati: {formatSourceTimestamp(openMeteoUpdatedAt)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
function StationSelect({ value, onChange, options, label, selectedIds = [] }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
      >
        {options.map((station) => (
          <option key={station.id} value={station.id}>{station.id} - {station.name}{selectedIds.includes(station.id) ? " (selezionata)" : ""}</option>
        ))}
      </select>
    </label>
  );
}

function MeasurementPanel({ index, config, onChange, measurements, stationCatalogs = STATIONS_BY_TYPE }) {
  const meta = getMeasurementMeta(config.type);
  const Icon = ICONS[meta.icon] || Gauge;
  const catalog = stationCatalogs[config.type] || STATIONS_BY_TYPE[config.type] || [];
  const rows = config.stationIds
    .map((stationId) => measurements[config.type]?.find((station) => station.id === stationId))
    .filter(Boolean);

  function updateStation(slot, stationId) {
    const nextIds = [...config.stationIds];
    nextIds[slot] = stationId;
    onChange({ ...config, stationIds: nextIds });
  }

  function updateType(type) {
    const nextCatalog = stationCatalogs[type] || STATIONS_BY_TYPE[type] || [];
    onChange({ ...config, type, stationIds: nextCatalog.slice(0, 3).map((station) => station.id) });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-emergency-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Controllo {index + 1}</h2>
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
            selectedIds={config.stationIds}
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

function MobileMeasurementPanel({ config, onChange, measurements, stationCatalogs = STATIONS_BY_TYPE }) {
  const meta = getMeasurementMeta(config.type);
  const Icon = ICONS[meta.icon] || Gauge;
  const catalog = stationCatalogs[config.type] || STATIONS_BY_TYPE[config.type] || [];
  const selectedIds = config.stationIds.filter(Boolean).slice(0, 3);
  const rows = selectedIds
    .map((stationId) => measurements[config.type]?.find((station) => station.id === stationId))
    .filter(Boolean);

  function updateType(type) {
    const nextCatalog = stationCatalogs[type] || STATIONS_BY_TYPE[type] || [];
    onChange({ ...config, type, stationIds: nextCatalog.slice(0, 3).map((station) => station.id) });
  }

  function selectStation(stationId) {
    if (!stationId || selectedIds.includes(stationId)) return;
    const nextIds = selectedIds.length < 3 ? [...selectedIds, stationId] : [...selectedIds.slice(1), stationId];
    onChange({ ...config, stationIds: nextIds });
  }

  function removeStation(stationId) {
    const nextIds = selectedIds.filter((id) => id !== stationId);
    onChange({ ...config, stationIds: nextIds });
  }

  return (
    <section className="panel overflow-hidden md:hidden">
      <div className="border-b border-emergency-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-sky-300" />
            <div>
              <h2 className="section-title">Controllo meteo</h2>
              <p className="text-xs text-slate-400">Seleziona il servizio e fino a 3 stazioni.</p>
            </div>
          </div>
          <select
            value={config.type}
            onChange={(event) => updateType(event.target.value)}
            className="max-w-[10rem] rounded-md border border-emergency-line bg-emergency-panel2 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            {Object.entries(MEASUREMENT_TYPES).map(([type, item]) => (
              <option key={type} value={type}>{item.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Aggiungi o sostituisci stazione</span>
          <select
            value=""
            onChange={(event) => selectStation(event.target.value)}
            className="w-full rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            <option value="">Seleziona una stazione</option>
            {catalog.map((station) => (
              <option key={station.id} value={station.id}>{station.id} - {station.name}{selectedIds.includes(station.id) ? " (selezionata)" : ""}</option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-2">
          {selectedIds.map((stationId) => {
            const station = catalog.find((item) => item.id === stationId);
            return (
              <button
                key={stationId}
                type="button"
                onClick={() => removeStation(stationId)}
                className="inline-flex items-center gap-2 rounded-full border border-yellow-300/70 bg-yellow-300/15 px-3 py-1.5 text-xs font-medium text-yellow-100"
              >
                {station?.name || stationId}
                <X className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>

        <div className="grid gap-3">
          {rows.map((row) => (
            <article key={row.id} className="rounded-lg border border-yellow-300/50 bg-yellow-300/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">{row.id}</p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-100">{row.name}</h3>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-500">{meta.valueLabel}</p>
                  <p className="mt-1 text-lg font-semibold text-sky-100">{row.value ?? "n.d."} {row.unit}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
                <div>
                  <p className="text-slate-500">Trend</p>
                  <TrendIcon trend={row.trend} />
                </div>
                <div>
                  <p className="text-slate-500">Fonte</p>
                  <p>{row.provider || "n.d."}</p>
                </div>
                <div>
                  <p className="text-slate-500">Agg.</p>
                  <p>{row.updatedAt || "n.d."}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
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
  const [panelConfigs, setPanelConfigs] = useState(DEFAULT_PANEL_CONFIGS);
  const [hydrometryCatalog, setHydrometryCatalog] = useState(STATIONS_BY_TYPE.hydrometry || []);

  async function loadObservationData() {
    try {
      const response = await fetch("/api/observations?refresh=1", { cache: "no-store" });
      const payload = await response.json();
      setObservationData((current) => mergeObservationData(current, payload));
    } catch (error) {
      setObservationData((current) => ({
        ...current,
        warning: current.warning || "Fonti dati non raggiungibili in questo momento. La dashboard mantiene gli ultimi valori disponibili."
      }));
    }
  }

  async function loadHydrometryData() {
    try {
      const response = await fetch("/api/hydrometry?province=FI&realtime=1&limit=all", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || payload?.error || "Idrometria non disponibile");
      const hydrometryStations = normalizeHydrometryForDashboard(payload);
      if (!hydrometryStations.length) return;
      setHydrometryCatalog(hydrometryStations.map((station) => ({
        id: station.id,
        name: station.name,
        type: station.type,
        lat: station.lat,
        lng: station.lng
      })));
      setObservationData((current) => ({
        ...current,
        measurements: {
          ...current.measurements,
          hydrometry: hydrometryStations
        },
        cfr: {
          ...(current.cfr || {}),
          fetchedAt: payload.fetchedAt,
          populatedStations: payload.counts?.realtime || 0,
          attemptedStations: payload.counts?.stations || hydrometryStations.length,
          mode: "official-hydrometry-api"
        },
        fetchedAt: payload.fetchedAt || current.fetchedAt,
        warning: current.warning === "CFR Toscana non ha restituito dati idrometrici leggibili per le stazioni richieste. Open-Meteo non fornisce livelli dei fiumi."
          ? null
          : current.warning
      }));
      setPanelConfigs((current) => current.map((config) => {
        if (config.type !== "hydrometry") return config;
        const validIds = new Set(hydrometryStations.map((station) => station.id));
        const nextIds = config.stationIds.filter((stationId) => validIds.has(stationId));
        hydrometryStations.some((station) => {
          if (nextIds.length >= 3) return true;
          if (!nextIds.includes(station.id)) nextIds.push(station.id);
          return false;
        });
        return { ...config, stationIds: nextIds.slice(0, 3) };
      }));
    } catch {
      setObservationData((current) => ({
        ...current,
        warning: current.warning || "Idrometria ufficiale CFR non raggiungibile in questo momento."
      }));
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

  const selectedObservationQuery = useMemo(() => buildSelectedObservationQuery(panelConfigs), [panelConfigs]);

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


  async function loadClientOpenMeteoData() {
    const selected = [];
    panelConfigs.forEach((config) => {
      if (!OPEN_METEO_CLIENT_TYPES.includes(config.type)) return;
      const catalog = STATIONS_BY_TYPE[config.type] || [];
      config.stationIds.forEach((stationId) => {
        const station = catalog.find((item) => item.id === stationId);
        const position = getStationPosition(stationId);
        if (station && Number.isFinite(position.lat) && Number.isFinite(position.lng)) {
          selected.push({ type: config.type, station: { ...station, ...position } });
        }
      });
    });

    const uniqueStations = [...new Map(selected.map((item) => [item.station.id, item.station])).values()];
    if (!uniqueStations.length) return;

    const responses = await Promise.allSettled(uniqueStations.map(async (station) => {
      const response = await fetch(getOpenMeteoClientUrl(station), { cache: "no-store" });
      if (!response.ok) throw new Error("Open Meteo HTTP " + response.status);
      return [station.id, await response.json()];
    }));
    const byStationId = new Map(responses
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value));
    const fetchedAt = new Date().toISOString();
    let filled = 0;

    setObservationData((current) => {
      const selectedKeys = new Set(selected.map((item) => item.type + ":" + item.station.id));
      const measurements = Object.fromEntries(Object.entries(current.measurements).map(([type, stations]) => [
        type,
        stations.map((station) => {
          if (!selectedKeys.has(type + ":" + station.id)) return station;
          const payload = byStationId.get(station.id);
          const value = getOpenMeteoClientValue(payload, type);
          if (value === null || value === undefined || Number.isNaN(Number(value))) return station;
          filled += 1;
          return {
            ...station,
            value: Number(Number(value).toFixed(type === "hygrometry" ? 0 : 1)),
            trend: "stable",
            updatedAt: payload?.current?.time?.slice(11, 16) || null,
            unavailable: false,
            real: true,
            provider: "Open Meteo"
          };
        })
      ]));

      return {
        ...current,
        source: "Open-Meteo + CFR Toscana",
        primarySource: "Open-Meteo per dati meteo, CFR Toscana per idrometria",
        measurements,
        openMeteo: {
          ...(current.openMeteo || {}),
          source: "Open Meteo",
          fetchedAt,
          populatedStations: filled,
          primaryTypes: OPEN_METEO_CLIENT_TYPES
        },
        openMeteoFallbackCount: filled,
        warning: current.warning === "Fonti dati non hanno restituito misure leggibili in questo momento." && filled ? null : current.warning
      };
    });
  }

  useEffect(() => {
    loadObservationData();
    loadHydrometryData();
    loadWeatherData();
    loadMeteoHubData();
  }, []);

  useEffect(() => {
    loadSelectedObservationData(selectedObservationQuery);
    loadClientOpenMeteoData();
  }, [selectedObservationQuery]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadObservationData();
      loadHydrometryData();
      loadWeatherData();
      loadSelectedObservationData(selectedObservationQuery);
      loadClientOpenMeteoData();
    }, DATA_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [selectedObservationQuery]);

  const hydrometryStations = observationData.measurements.hydrometry || [];
  const stationCatalogs = useMemo(() => ({
    ...STATIONS_BY_TYPE,
    hydrometry: hydrometryCatalog
  }), [hydrometryCatalog]);
  const highestHydroStatus = useMemo(() => {
    if (hydrometryStations.some((station) => getStationStatus(station) === "Rosso")) return "Rosso";
    if (hydrometryStations.some((station) => getStationStatus(station) === "Giallo")) return "Giallo";
    return "Verde";
  }, [hydrometryStations]);

  const visibleAlert = alert.level !== "Verde" ? alert.level : highestHydroStatus;
  const mapStations = Object.values(observationData.measurements).flat();

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-emergency-line bg-emergency-panel/80 p-4 shadow-glow sm:p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Provincia di Firenze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Dashboard meteo e idrometria Firenze</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Monitoraggio con Open Meteo come fonte primaria per le grandezze meteorologiche e CFR Toscana per i livelli idrometrici.</p>
          </div>
          <div className={`w-full rounded-lg border px-4 py-3 sm:w-auto ${ALERT_STYLE[visibleAlert]}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-medium">Allerta attiva</span>
            </div>
            <p className="mt-1 text-2xl font-semibold">{visibleAlert}</p>
          </div>
        </header>

        <PdfParser onAlertDetected={setAlert} />

        <SourceStatusPanel observationData={observationData} />

        {observationData.warning && (
          <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{observationData.warning}</div>
        )}

        <MapDashboard stations={mapStations} />

        <MobileMeasurementPanel
          config={panelConfigs[0]}
          measurements={observationData.measurements}
          stationCatalogs={stationCatalogs}
          onChange={(nextConfig) => {
            setPanelConfigs((current) => current.map((item, index) => index === 0 ? nextConfig : item));
          }}
        />

        <section className="hidden gap-5 md:grid xl:grid-cols-2">
          {panelConfigs.map((config, index) => (
            <MeasurementPanel
              key={config.id}
              index={index}
              config={config}
              measurements={observationData.measurements}
              stationCatalogs={stationCatalogs}
              onChange={(nextConfig) => {
                setPanelConfigs((current) => current.map((item) => item.id === config.id ? nextConfig : item));
              }}
            />
          ))}
        </section>

        <WeatherForecastPanel weatherData={weatherData} />

        <MeteoHubPanel meteoHubData={meteoHubData} />

        <WebcamGrid />

        <footer className="pb-6 text-xs text-slate-500">
          Fonti osservazioni: Open Meteo per meteo e neve, CFR Toscana per idrometria. Ultimo aggiornamento: {formatSourceTimestamp(observationData.fetchedAt)}.
        </footer>
      </div>
      </main>
    </>
  );
}
