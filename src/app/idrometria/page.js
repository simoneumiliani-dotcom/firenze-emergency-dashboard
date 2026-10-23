"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, History, RefreshCcw, Waves } from "lucide-react";
import {
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import AppNav from "@/components/AppNav";
import LazySection from "@/components/LazySection";

const LEVEL_LINE_COLOR = "#2f36d8";
const LEVEL_ONE_COLOR = "#e8df20";
const LEVEL_TWO_COLOR = "#ef4444";

function formatTime(value) {
  if (!value) return "n.d.";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function formatChartTime(value) {
  if (!value) return "n.d.";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function getStationLabel(station) {
  if (!station) return "Stazione non selezionata";
  const river = station.river_name ? station.river_name + " - " : "";
  return river + station.station_name;
}

// Number(null) vale 0: senza questo controllo una soglia assente diventerebbe
// una soglia a 0 m, cioe' un allarme falso.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildRealtimeTrendPoints(realtime) {
  const value = Number(realtime?.level_m);
  if (!Number.isFinite(value)) return [];
  const baseTime = realtime?.measurement_time ? new Date(realtime.measurement_time).getTime() : Date.now();
  const points = [
    { hoursAgo: 6, delta: Number(realtime?.delta_h6_m) },
    { hoursAgo: 3, delta: Number(realtime?.delta_h3_m) },
    { hoursAgo: 1, delta: Number(realtime?.delta_h1_m) }
  ]
    .filter((point) => Number.isFinite(point.delta))
    .map((point) => ({
      measurement_time: new Date(baseTime - point.hoursAgo * 60 * 60 * 1000).toISOString(),
      level_m: Number((value - point.delta).toFixed(2))
    }));

  return [
    ...points,
    { measurement_time: new Date(baseTime).toISOString(), level_m: value }
  ];
}

function HydrometryTrendChart({ stations, realtimeRows, historicalRows, selectedId, onSelect }) {
  const realtimeByStation = useMemo(
    () => new Map((realtimeRows || []).map((row) => [row.station_id, row])),
    [realtimeRows]
  );
  const selectedStation = stations.find((station) => station.station_id === selectedId) || stations[0] || null;
  const selectedRealtime = selectedStation ? realtimeByStation.get(selectedStation.station_id) : null;
  const stationHistoricalRows = (historicalRows || [])
    .filter((row) => row.station_id === selectedStation?.station_id)
    .filter((row) => Number.isFinite(Number(row.level_m)));
  const rawRows = stationHistoricalRows.length ? stationHistoricalRows.slice(-48) : buildRealtimeTrendPoints(selectedRealtime);
  const currentLevel = Number(selectedRealtime?.level_m ?? rawRows[rawRows.length - 1]?.level_m);
  // Solo soglie ufficiali CFR: se mancano non vengono inventate a partire dal
  // livello misurato, altrimenti il grafico mostrerebbe limiti che non esistono.
  const levelOne = toFiniteNumber(selectedRealtime?.warning_m);
  const levelTwo = toFiniteNumber(selectedRealtime?.danger_m);
  const chartData = rawRows.map((row) => ({
    time: formatChartTime(row.measurement_time),
    timestamp: row.measurement_time,
    level: Number(row.level_m)
  }));
  const yValues = [
    ...chartData.map((row) => row.level),
    levelOne,
    levelTwo
  ].filter(Number.isFinite);
  const yMax = yValues.length ? Math.max(1, Math.ceil((Math.max(...yValues) + 0.4) * 2) / 2) : 4;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-emergency-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Waves className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Andamento idrometrico</h2>
            <p className="muted">Grafico operativo in stile CFR con soglie e livello della stazione selezionata.</p>
          </div>
        </div>
        <select
          value={selectedStation?.station_id || ""}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400 lg:max-w-md"
        >
          {stations.map((station) => (
            <option key={station.station_id} value={station.station_id}>
              {station.station_code} - {station.station_name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-slate-100 p-3 text-slate-950 sm:p-4">
        <div className="rounded-md border border-slate-500 bg-white">
          <div className="border-b border-slate-400 px-3 py-2 text-sm font-semibold text-indigo-800">
            {getStationLabel(selectedStation)}
          </div>
          <div className="grid gap-3 p-3 lg:grid-cols-[1fr_11rem]">
            <div className="h-[22rem] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 20, right: 20, top: 14, bottom: 24 }}>
                  <CartesianGrid stroke="#d9d9d9" />
                  <XAxis
                    dataKey="time"
                    interval="preserveStartEnd"
                    tick={{ fill: "#111827", fontSize: 11 }}
                    stroke="#111827"
                  />
                  <YAxis
                    domain={[0, yMax]}
                    tick={{ fill: "#111827", fontSize: 11 }}
                    stroke="#111827"
                    width={48}
                  >
                    <Label value="Altezza idrometrica [m s.z.i.]" angle={-90} position="insideLeft" fill="#2f36d8" fontSize={12} />
                  </YAxis>
                  {Number.isFinite(levelOne) && <ReferenceLine y={levelOne} stroke={LEVEL_ONE_COLOR} strokeWidth={2} />}
                  {Number.isFinite(levelTwo) && <ReferenceLine y={levelTwo} stroke={LEVEL_TWO_COLOR} strokeWidth={2} />}
                  <Tooltip
                    contentStyle={{ background: "#eef2ff", border: "1px solid #2f36d8", color: "#111827", borderRadius: 0 }}
                    formatter={(value) => [Number(value).toFixed(2) + " m", "Altezza idrometrica"]}
                    labelFormatter={(label) => label}
                  />
                  <Legend verticalAlign="bottom" height={28} wrapperStyle={{ color: "#111827", fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="level"
                    name="Altezza idrometrica [m s.z.i.]"
                    stroke={LEVEL_LINE_COLOR}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-semibold text-indigo-800">Soglie operative</p>
                <p className="mt-1"><span className="inline-block h-2.5 w-6 rounded-sm bg-yellow-300" /> Livello 1 -&gt; {levelOne === null ? "soglia non disponibile" : levelOne + " m"}</p>
                <p><span className="inline-block h-2.5 w-6 rounded-sm bg-red-500" /> Livello 2 -&gt; {levelTwo === null ? "soglia non disponibile" : levelTwo + " m"}</p>
                {levelOne === null && levelTwo === null && (
                  <p className="mt-1 text-xs text-slate-600">CFR Toscana non pubblica le soglie per questa stazione: nessuna linea di riferimento nel grafico.</p>
                )}
              </div>
              <div className="rounded border border-slate-300 bg-slate-50 p-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ultima misura</p>
                <p className="mt-1 font-semibold text-slate-950">{Number.isFinite(currentLevel) ? currentLevel.toFixed(2) + " m" : "n.d."}</p>
                <p className="text-xs text-slate-600">{formatTime(selectedRealtime?.measurement_time)}</p>
              </div>
              <div className="rounded border border-slate-300 bg-slate-50 p-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Variazioni livello</p>
                <p className="mt-1">Δh1: {Number.isFinite(Number(selectedRealtime?.delta_h1_m)) ? Number(selectedRealtime.delta_h1_m).toFixed(2) + " m" : "n.d."}</p>
                <p>Δh3: {Number.isFinite(Number(selectedRealtime?.delta_h3_m)) ? Number(selectedRealtime.delta_h3_m).toFixed(2) + " m" : "n.d."}</p>
                <p>Δh6: {Number.isFinite(Number(selectedRealtime?.delta_h6_m)) ? Number(selectedRealtime.delta_h6_m).toFixed(2) + " m" : "n.d."}</p>
              </div>
              <p className="text-xs text-slate-600">
                Realtime CFR non validato. Se lo storico SIR della stazione e&apos; caricato, il grafico usa la serie storica; altrimenti ricostruisce l&apos;andamento da attuale, Δh1, Δh3 e Δh6.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceMatrix({ items }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-emergency-line px-4 py-3">
        <Database className="h-5 w-5 text-sky-300" />
        <div>
          <h2 className="section-title">Fonti ufficiali idrometria</h2>
          <p className="muted">Mappatura fonte, contenuto, formato e uso applicativo.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-emergency-line text-sm">
          <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Fonte</th>
              <th className="px-4 py-3">Contenuto</th>
              <th className="px-4 py-3">Formato</th>
              <th className="px-4 py-3">Uso applicativo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emergency-line">
            {items.map((item) => (
              <tr key={item.source}>
                <td className="px-4 py-3 font-medium text-slate-100">{item.source}</td>
                <td className="px-4 py-3 text-slate-300">{item.content}</td>
                <td className="px-4 py-3 text-sky-100">{item.format}</td>
                <td className="px-4 py-3 text-slate-400">{item.applicationUse}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RealtimeTable({ rows }) {
  const delta = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) + " m" : "n.d.");

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-emergency-line px-4 py-3">
        <Waves className="h-5 w-5 text-sky-300" />
        <div>
          <h2 className="section-title">Realtime CFR</h2>
          <p className="muted">Livelli e portate operative, non validati.</p>
        </div>
      </div>
      <div className="border-b border-emergency-orange/40 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">
        <AlertTriangle className="mr-2 inline h-4 w-4" />
        Dati CFR in tempo reale non validati: usare per monitoraggio operativo, non per reportistica ufficiale storica.
      </div>
      <div className="grid gap-2 p-3 md:hidden">
        {rows.length ? rows.map((row) => (
          <article key={row.station_id} className="rounded-lg border border-emergency-line bg-black/10 px-3 py-3">
            <p className="text-sm font-medium text-slate-100">{row.station_name}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-slate-500">Livello</p>
                <p className="text-sky-100">{row.level_m ?? "n.d."} m</p>
              </div>
              <div>
                <p className="text-slate-500">Portata</p>
                <p className="text-slate-300">{row.flow_mc_s ?? "n.d."} mc/s</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span>Δh1 {delta(row.delta_h1_m)}</span>
              <span>Δh3 {delta(row.delta_h3_m)}</span>
              <span>Δh6 {delta(row.delta_h6_m)}</span>
              <span>{formatTime(row.measurement_time)}</span>
            </div>
          </article>
        )) : (
          <p className="text-sm text-slate-400">Realtime non disponibile nel caricamento corrente.</p>
        )}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-emergency-line text-sm">
          <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Stazione</th>
              <th className="px-4 py-3">Livello</th>
              <th className="px-4 py-3">Portata</th>
              <th className="px-4 py-3">Δh1</th>
              <th className="px-4 py-3">Δh3</th>
              <th className="px-4 py-3">Δh6</th>
              <th className="px-4 py-3">Ora misura</th>
              <th className="px-4 py-3">Validato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-emergency-line">
            {rows.length ? rows.map((row) => (
              <tr key={row.station_id}>
                <td className="px-4 py-3 font-medium text-slate-100">{row.station_name}</td>
                <td className="px-4 py-3 text-sky-100">{row.level_m ?? "n.d."} m</td>
                <td className="px-4 py-3 text-slate-300">{row.flow_mc_s ?? "n.d."} mc/s</td>
                <td className="px-4 py-3 text-slate-300">{Number.isFinite(Number(row.delta_h1_m)) ? Number(row.delta_h1_m).toFixed(2) + " m" : "n.d."}</td>
                <td className="px-4 py-3 text-slate-300">{Number.isFinite(Number(row.delta_h3_m)) ? Number(row.delta_h3_m).toFixed(2) + " m" : "n.d."}</td>
                <td className="px-4 py-3 text-slate-300">{Number.isFinite(Number(row.delta_h6_m)) ? Number(row.delta_h6_m).toFixed(2) + " m" : "n.d."}</td>
                <td className="px-4 py-3 text-slate-400">{formatTime(row.measurement_time)}</td>
                <td className="px-4 py-3 text-orange-100">no</td>
              </tr>
            )) : (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={8}>Realtime non disponibile nel caricamento corrente.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalPanel({ station, stations, selectedId, onSelect, rows, loading, error, onLoad }) {
  const hasStations = stations.length > 0;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-emergency-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Storico SIR</h2>
            <p className="muted">Catalogo storico separato: solo stazioni SIR idrometriche catalogate.</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:min-w-[22rem]">
          <select
            value={selectedId || ""}
            onChange={(event) => onSelect(event.target.value)}
            disabled={!hasStations}
            className="w-full rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            <option value="">{hasStations ? "Seleziona stazione" : "Nessuna stazione con storico"}</option>
            {stations.map((item) => (
              <option key={item.station_id} value={item.station_id}>
                {item.station_code} - {item.station_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onLoad}
            disabled={!station || loading || !hasStations}
            className="inline-flex items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Caricamento..." : "Carica storico"}
          </button>
        </div>
      </div>
      <div className="p-4">
        <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3 text-sm">
          <p className="font-semibold text-slate-100">{station?.station_name || "Nessuna stazione selezionata"}</p>
          <p className="mt-1 text-slate-400">Risorsa storico: {station?.historical_url || "non disponibile"}</p>
          <p className="mt-1 text-xs text-slate-500">Catalogo storico SIR: {stations.length} stazioni</p>
        </div>
        {error && <div className="mt-4 rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-3 py-2 text-sm text-orange-100">{error}</div>}
        <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-emergency-line">
          <table className="min-w-full divide-y divide-emergency-line text-sm">
            <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Livello</th>
                <th className="px-4 py-3">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emergency-line">
              {rows.length ? rows.slice(-25).reverse().map((row, index) => (
                <tr key={row.station_id + index}>
                  <td className="px-4 py-3 text-slate-300">{formatTime(row.measurement_time)}</td>
                  <td className="px-4 py-3 text-sky-100">{row.level_m ?? "n.d."} m</td>
                  <td className="px-4 py-3 text-slate-400">{row.raw_flag || "n.d."}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-4 py-4 text-slate-400" colSpan={3}>Storico non caricato o non disponibile per questa stazione.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default function IdrometriaPage() {
  const [payload, setPayload] = useState(null);
  const [selectedStationId, setSelectedStationId] = useState(null);
  const [selectedTrendStationId, setSelectedTrendStationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historicalError, setHistoricalError] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ province: "FI", realtime: "1", limit: "all" });
      const response = await fetch("/api/hydrometry?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || "Errore idrometria");
      setPayload((current) => ({
        ...data,
        historicalMeasurements: current?.historicalMeasurements || []
      }));
      if (!selectedStationId && data.historicalCatalog?.length) {
        const firstHistorical = data.historicalCatalog[0] || null;
        setSelectedStationId(firstHistorical?.station_id || null);
      }
      if (!selectedTrendStationId && data.stations?.length) {
        const firstRealtime = data.realtimeMeasurements?.[0]?.station_id;
        setSelectedTrendStationId(firstRealtime || data.stations[0].station_id);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadHistorical(stationId = selectedStationId) {
    if (!stationId) return;
    setHistoricalLoading(true);
    setHistoricalError(null);
    try {
      const params = new URLSearchParams({
        province: "FI",
        realtime: "0",
        historical: "1",
        historicalStationId: stationId,
        historicalLimit: "120"
      });
      const response = await fetch("/api/hydrometry?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.message || data?.error || "Storico non disponibile");
      if (data.historicalError) throw new Error(data.historicalError);
      const historicalMeasurements = data.historicalMeasurements || [];
      if (!historicalMeasurements.length) {
        throw new Error("Nessun dato storico disponibile per questa stazione.");
      }
      setPayload((current) => ({
        ...(current || data),
        historicalMeasurements,
        counts: {
          ...(current?.counts || data.counts || {}),
          historical: historicalMeasurements.length
        }
      }));
    } catch (err) {
      setHistoricalError(err?.message || String(err));
    } finally {
      setHistoricalLoading(false);
    }
  }

  const historicalStations = payload?.historicalCatalog || [];

  const selectedStation = useMemo(
    () => historicalStations.find((station) => station.station_id === selectedStationId) || null,
    [historicalStations, selectedStationId]
  );
  const selectedTrendId = selectedTrendStationId || selectedStationId || payload?.stations?.[0]?.station_id || "";

  useEffect(() => {
    if (!historicalStations.length) {
      if (selectedStationId) setSelectedStationId(null);
      return;
    }
    if (!selectedStationId || !historicalStations.some((station) => station.station_id === selectedStationId)) {
      setSelectedStationId(historicalStations[0].station_id);
    }
  }, [historicalStations, selectedStationId]);

  function handleHistoricalStationChange(stationId) {
    setSelectedStationId(stationId);
    setHistoricalError(null);
    setPayload((current) => current ? { ...current, historicalMeasurements: [] } : current);
  }

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <header className="rounded-lg border border-emergency-line bg-emergency-panel/80 p-4 shadow-glow sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Provincia di Firenze</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Idrometria ufficiale</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">Anagrafica OpenData, realtime CFR non validato e collegamento allo storico SIR.</p>
              </div>
              <button
                type="button"
                onClick={() => loadData()}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20"
              >
                <RefreshCcw className="h-4 w-4" />
                Aggiorna
              </button>
            </div>
          </header>

          {error && <div className="rounded-lg border border-emergency-red/50 bg-emergency-red/10 px-4 py-3 text-sm text-red-100">{error}</div>}
          {loading && <div className="rounded-lg border border-emergency-line bg-emergency-panel px-4 py-3 text-sm text-slate-300">Caricamento dati idrometrici...</div>}
          {payload?.realtimeDiagnostics?.bulk?.discoveredLinks?.length ? (
            <div className="rounded-lg border border-sky-400/40 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
              Export CFR rilevato: {payload.realtimeDiagnostics.bulk.discoveredLinks.join(", ")}
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Stazioni</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.stations ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Realtime CFR</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.realtime ?? 0}</p>
              <p className="mt-1 text-xs text-slate-400">Bulk CFR: {payload?.realtimeDiagnostics?.bulkRows ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Storico caricato</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.historical ?? 0}</p>
              <p className="mt-1 text-xs text-slate-400">Catalogo SIR: {payload?.counts?.historicalCatalog ?? 0}</p>
            </div>
          </section>

          <LazySection minHeight="20rem" label="Il grafico si carica scorrendo…">
            <HydrometryTrendChart
              stations={payload?.stations || []}
              realtimeRows={payload?.realtimeMeasurements || []}
              historicalRows={payload?.historicalMeasurements || []}
              selectedId={selectedTrendId}
              onSelect={setSelectedTrendStationId}
            />
          </LazySection>

          <section className="grid gap-5 xl:grid-cols-2">
            <RealtimeTable rows={payload?.realtimeMeasurements || []} />
            <HistoricalPanel
              station={selectedStation}
              stations={historicalStations}
              selectedId={selectedStationId}
              onSelect={handleHistoricalStationChange}
              rows={payload?.historicalMeasurements || []}
              loading={historicalLoading}
              error={historicalError}
              onLoad={() => loadHistorical(selectedStationId)}
            />
          </section>

          <SourceMatrix items={payload?.sourceMatrix || []} />
        </div>
      </main>
    </>
  );
}
