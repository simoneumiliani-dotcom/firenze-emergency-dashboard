"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CloudRain,
  Droplets,
  Gauge,
  Snowflake,
  Thermometer,
  Waves,
  Wind,
  X
} from "lucide-react";
import PdfParser from "@/components/PdfParser";
import LazySection from "@/components/LazySection";
import PageHeader from "@/components/PageHeader";
import PageLayout from "@/components/PageLayout";
import SituationStrip from "@/components/SituationStrip";
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

// Number(null) vale 0: usato sulle soglie trasformerebbe "soglia assente" in
// "soglia a 0 m", cioe' in un allarme falso.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

// Una sola richiesta per tutte le stazioni selezionate: con 6 stazioni il vecchio
// codice apriva 6 connessioni in parallelo e prendeva 429 dal provider.
function getOpenMeteoBatchUrl(stations) {
  const params = new URLSearchParams({
    latitude: stations.map((station) => Number(station.lat).toFixed(4)).join(","),
    longitude: stations.map((station) => Number(station.lng).toFixed(4)).join(","),
    current: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
    hourly: "snow_depth",
    timezone: "Europe/Rome",
    forecast_days: "1"
  });
  return "https://api.open-meteo.com/v1/forecast?" + params.toString();
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
    const numericValue = toFiniteNumber(realtime?.level_m);
    const hasValue = numericValue !== null;
    // Soglie solo se pubblicate da CFR: nessun valore derivato dal livello misurato.
    const warning = toFiniteNumber(realtime?.warning_m);
    const danger = toFiniteNumber(realtime?.danger_m);

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
  const value = toFiniteNumber(station.value);
  const danger = toFiniteNumber(station.danger);
  const warning = toFiniteNumber(station.warning);
  // Senza livello o senza soglie ufficiali non si puo' dire "verde":
  // sarebbe un falso "tutto tranquillo".
  if (value === null || (danger === null && warning === null)) return null;
  if (danger !== null && value >= danger) return "Rosso";
  if (warning !== null && value >= warning) return "Giallo";
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
            <h2 className="section-title">{meta.label}</h2>
            <p className="text-xs text-slate-400">Controllo {index + 1} · {rows.length} stazioni</p>
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
              <th className="px-3 py-3">Stazione</th>
              <th className="px-3 py-3">{meta.valueLabel}</th>
              <th className="px-3 py-3">Trend</th>
              <th className="px-3 py-3">Fonte</th>
              <th className="px-3 py-3 text-right">Agg.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emergency-line">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-white/[0.03]">
                <td className="px-3 py-3 font-medium text-slate-100">
                  {row.name}
                  <span className="mt-0.5 block font-mono text-[10px] font-normal text-slate-500">{row.id}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-200">{row.value ?? "n.d."} {row.value !== null && row.value !== undefined ? row.unit : ""}</td>
                <td className="px-3 py-3"><TrendIcon trend={row.trend} /></td>
                <td className="px-3 py-3 text-slate-400">
                  {row.provider || "n.d."}
                  {row.modelled ? <span className="ml-1 text-xs text-sky-300">(coord.)</span> : null}
                  {row.unavailable ? <span className="ml-1 text-xs text-orange-200">(in attesa)</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right text-slate-400">{row.updatedAt || "n.d."}</td>
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
        <div className="flex items-center justify-between gap-3">            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-sky-300" />
              <div>
                <h2 className="section-title">{meta.label}</h2>
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

export default function DashboardPage() {
  const [alert, setAlert] = useState({ level: "Verde", matches: [], fileName: null });
  const refreshingRef = useRef(false);
  const [observationData, setObservationData] = useState(normalizeObservationData(null));
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

    const byStationId = new Map();

    try {
      const response = await fetch(getOpenMeteoBatchUrl(uniqueStations), { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        const list = Array.isArray(payload) ? payload : [payload];
        if (list.length === uniqueStations.length) {
          uniqueStations.forEach((station, index) => byStationId.set(station.id, list[index]));
        }
      }
    } catch {
      // Se il batch non risponde si ricade sulle singole stazioni, in sequenza.
    }

    if (!byStationId.size) {
      for (const station of uniqueStations) {
        try {
          const response = await fetch(getOpenMeteoClientUrl(station), { cache: "no-store" });
          if (response.ok) byStationId.set(station.id, await response.json());
        } catch {
          // stazione saltata: le altre restano aggiornabili
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
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
  }, []);

  useEffect(() => {
    loadSelectedObservationData(selectedObservationQuery);
    loadClientOpenMeteoData();
  }, [selectedObservationQuery]);

  useEffect(() => {
    const refreshAll = () => {
      if (document.hidden || refreshingRef.current) return;
      refreshingRef.current = true;
      Promise.allSettled([
        loadObservationData(),
        loadHydrometryData(),
        loadSelectedObservationData(selectedObservationQuery),
        loadClientOpenMeteoData()
      ]).finally(() => {
        refreshingRef.current = false;
      });
    };

    const timer = window.setInterval(refreshAll, DATA_REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedObservationQuery]);

  const hydrometryStations = observationData.measurements.hydrometry || [];
  const stationCatalogs = useMemo(() => ({
    ...STATIONS_BY_TYPE,
    hydrometry: hydrometryCatalog
  }), [hydrometryCatalog]);
  const hydroStatuses = useMemo(
    () => hydrometryStations.map((station) => getStationStatus(station)).filter(Boolean),
    [hydrometryStations]
  );
  const highestHydroStatus = hydroStatuses.includes("Rosso")
    ? "Rosso"
    : hydroStatuses.includes("Giallo")
      ? "Giallo"
      : hydroStatuses.includes("Verde")
        ? "Verde"
        : null;

  // Il livello "di allerta" esiste solo se c'e' un bollettino pubblicato: il
  // resto e' lo stato idrometrico, che va etichettato per quello che e'.
  const hasBulletinAlert = Boolean(alert.fileName) || alert.level !== "Verde";
  const alertLabel = hasBulletinAlert ? "Stato di allerta" : "Stato idrometrico";
  const alertHref = hasBulletinAlert ? "/allerte" : "/idrometria";
  const visibleAlert = hasBulletinAlert ? alert.level : (highestHydroStatus || "n.d.");
  const alertStyle = ALERT_STYLE[visibleAlert] || "border-emergency-line bg-emergency-panel2 text-slate-300";
  const mapStations = Object.values(observationData.measurements).flat();

  return (
    <PageLayout>
        <PageHeader
          eyebrow="Provincia di Firenze"
          title="Dashboard meteo e idrometria Firenze"
          description="Situazione in corso sulla provincia: livelli idrometrici CFR Toscana, pluviometria, temperatura e vento delle stazioni monitorate, con la mappa interattiva delle stazioni e degli stati di soglia."
        >
          <Link
            href={alertHref}
            aria-label={"Apri " + (hasBulletinAlert ? "la pagina Allerte e criticità" : "la pagina Idrometria") + ", livello " + visibleAlert}
            className={`group block w-full rounded-lg border px-4 py-3 transition hover:shadow-glow md:w-64 ${alertStyle}`}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-medium">{alertLabel}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold">{visibleAlert}</p>
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium opacity-80 group-hover:opacity-100">
              {hasBulletinAlert ? "Dettagli allerte" : "Dettagli idrometria"}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </span>
          </Link>
        </PageHeader>

        {observationData.warning && (
          <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{observationData.warning}</div>
        )}

        <SituationStrip
          measurements={observationData.measurements}
          fetchedAt={observationData.fetchedAt}
          cfrUpdatedAt={observationData.cfr?.fetchedAt}
          openMeteoUpdatedAt={observationData.openMeteo?.fetchedAt}
        />

        <LazySection minHeight="24rem" label="La mappa si carica scorrendo…">
          <MapDashboard stations={mapStations} />
        </LazySection>

        <MobileMeasurementPanel
          config={panelConfigs[0]}
          measurements={observationData.measurements}
          stationCatalogs={stationCatalogs}
          onChange={(nextConfig) => {
            setPanelConfigs((current) => current.map((item, index) => index === 0 ? nextConfig : item));
          }}
        />

        <section className="hidden gap-5 md:grid lg:grid-cols-2">
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

        <PdfParser onAlertDetected={setAlert} />

        <footer className="flex flex-col gap-2 pb-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Fonti osservazioni: Open-Meteo per meteo e neve, CFR Toscana per idrometria. Ultimo aggiornamento: {formatSourceTimestamp(observationData.fetchedAt)}.
          </p>
          <Link
            href="/fonti"
            className="inline-flex items-center gap-1 font-medium text-sky-300 transition hover:text-sky-100"
          >
            Tutte le fonti e i download
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </footer>
    </PageLayout>
  );
}
