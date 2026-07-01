"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CloudRain,
  Droplets,
  Gauge,
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

function normalizeCfrData(payload) {
  const fallback = buildFallbackMeasurements();
  return {
    measurements: payload?.measurements || fallback,
    source: payload?.source || "Catalogo stazioni locale",
    fetchedAt: payload?.fetchedAt || null,
    warning: payload?.warning || null
  };
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
          <h2 className="section-title">Dashboard {index + 1}</h2>
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
          <p className="muted">Selezione manuale delle stazioni. Ogni linea e ogni soglia hanno colore dedicato.</p>
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
          <p className="muted">Verifica autenticazione e richieste di estrazione dati configurate.</p>
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
  const [cfrData, setCfrData] = useState(normalizeCfrData(null));
  const [weatherData, setWeatherData] = useState(normalizeWeatherData(null));
  const [meteoHubData, setMeteoHubData] = useState(normalizeMeteoHubData(null));
  const [loading, setLoading] = useState(true);
  const [panelConfigs, setPanelConfigs] = useState(DEFAULT_PANEL_CONFIGS);
  const [chartStationIds, setChartStationIds] = useState(DEFAULT_CHART_STATION_IDS);

  async function loadCfrData() {
    setLoading(true);
    try {
      const response = await fetch("/api/cfr-data", { cache: "no-store" });
      const payload = await response.json();
      setCfrData(normalizeCfrData(payload));
    } catch (error) {
      setCfrData(normalizeCfrData({ warning: "Fonte CFR non raggiungibile. I valori CFR sono indicati come n.d." }));
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

  useEffect(() => {
    loadCfrData();
    loadWeatherData();
    loadMeteoHubData();
  }, []);

  const hydrometryStations = cfrData.measurements.hydrometry || [];
  const highestHydroStatus = useMemo(() => {
    if (hydrometryStations.some((station) => getStationStatus(station) === "Rosso")) return "Rosso";
    if (hydrometryStations.some((station) => getStationStatus(station) === "Giallo")) return "Giallo";
    return "Verde";
  }, [hydrometryStations]);

  const visibleAlert = alert.level !== "Verde" ? alert.level : highestHydroStatus;
  const mapStations = Object.values(cfrData.measurements).flat();

  return (
    <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-emergency-line bg-emergency-panel/80 p-4 shadow-glow md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Provincia di Firenze</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white md:text-3xl">Dashboard allerta meteo ed emergenze</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">Monitoraggio configurabile CFR Toscana per pluviometria, idrometria, termometria, anemometria, igrometria e nivometria.</p>
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
            return <StatCard key={type} icon={Icon} label={meta.label} value={loading ? "..." : cfrData.measurements[type]?.length || 0} />;
          })}
        </section>

        {cfrData.warning && (
          <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">{cfrData.warning}</div>
        )}

        <MapDashboard stations={mapStations} />

        <section className="grid gap-5 xl:grid-cols-2">
          {panelConfigs.map((config, index) => (
            <MeasurementPanel
              key={config.id}
              index={index}
              config={config}
              measurements={cfrData.measurements}
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
          Fonte stazioni: {cfrData.source}. Meteo: {weatherData.source} {weatherData.fetchedAt || ""}. Ultimo tentativo CFR: {cfrData.fetchedAt || "n.d."}.
        </footer>
      </div>
    </main>
  );
}
