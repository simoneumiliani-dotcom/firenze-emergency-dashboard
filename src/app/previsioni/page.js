"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Cloud,
  CloudRain,
  CloudSun,
  Crosshair,
  ExternalLink,
  LocateFixed,
  MapPin,
  Moon,
  RefreshCcw,
  Snowflake,
  Sun,
  Thermometer,
  Wind
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import AppNav from "@/components/AppNav";

const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const MUNICIPALITIES = [
  { id: "firenze", name: "Firenze", lat: 43.7696, lng: 11.2558 },
  { id: "bagno-a-ripoli", name: "Bagno a Ripoli", lat: 43.7512, lng: 11.3225 },
  { id: "borgo-san-lorenzo", name: "Borgo S. Lorenzo", lat: 43.9555, lng: 11.3856 },
  { id: "calenzano", name: "Calenzano", lat: 43.8583, lng: 11.1667 },
  { id: "campi-bisenzio", name: "Campi Bisenzio", lat: 43.8245, lng: 11.1302 },
  { id: "empoli", name: "Empoli", lat: 43.7179, lng: 10.9476 },
  { id: "figline-incisa", name: "Figline e Incisa Valdarno", lat: 43.6198, lng: 11.4693 },
  { id: "firenzuola", name: "Firenzuola", lat: 44.1197, lng: 11.3793 },
  { id: "greve", name: "Greve in Chianti", lat: 43.5851, lng: 11.3171 },
  { id: "lastra-a-signa", name: "Lastra a Signa", lat: 43.7696, lng: 11.1052 },
  { id: "marradi", name: "Marradi", lat: 44.0735, lng: 11.6132 },
  { id: "pontassieve", name: "Pontassieve", lat: 43.7748, lng: 11.4381 },
  { id: "scandicci", name: "Scandicci", lat: 43.7542, lng: 11.1879 },
  { id: "sesto-fiorentino", name: "Sesto Fiorentino", lat: 43.8333, lng: 11.2 },
  { id: "signa", name: "Signa", lat: 43.7812, lng: 11.0979 },
  { id: "vicchio", name: "Vicchio", lat: 43.9337, lng: 11.4654 }
];

const HAZARD_STYLE = {
  Verde: "border-emergency-green/50 bg-emergency-green/10 text-green-100",
  Giallo: "border-emergency-yellow/60 bg-emergency-yellow/10 text-yellow-100",
  Arancione: "border-emergency-orange/60 bg-emergency-orange/10 text-orange-100",
  Rosso: "border-emergency-red/60 bg-emergency-red/10 text-red-100"
};

function formatDateTime(value) {
  if (!value) return "in attesa";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) + " ora " +
    date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function weatherLabel(code) {
  if (code === 0) return "Sereno";
  if ([1, 2, 3].includes(code)) return "Variabile";
  if ([45, 48].includes(code)) return "Nebbia";
  if ([51, 53, 55, 56, 57].includes(code)) return "Pioviggine";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Pioggia";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Neve";
  if ([95, 96, 99].includes(code)) return "Temporali";
  return "Meteo";
}

function highestHazard(sources) {
  const order = { Verde: 0, Giallo: 1, Arancione: 2, Rosso: 3 };
  const hazards = sources.flatMap((source) => source.hazards || []);
  if (!hazards.length) return { level: "Verde", label: "Nessuna soglia superata", detail: "Scenario ordinario sui parametri previsionali" };
  return hazards.sort((a, b) => order[b.level] - order[a.level])[0];
}

function getPrimarySource(payload) {
  return payload?.sources?.find((source) => source.id === "open-meteo") || payload?.sources?.[0] || null;
}

function buildChartRows(primary) {
  const rows = (primary?.hourly || []).map((point) => ({
    hour: point.hour,
    date: point.time,
    precipitation: point.precipitation ?? 0,
    temperature: point.temperature,
    windGust: point.windGust,
    probability: point.precipitationProbability,
    humidity: point.humidity,
    snow: point.snowfall ?? 0
  }));
  return rows;
}

function buildDailyRows(primary) {
  return (primary?.daily || []).map((day) => ({
    day: day.day,
    label: formatDay(day.day),
    weatherCode: day.weatherCode,
    temperatureMax: day.temperatureMax,
    temperatureMin: day.temperatureMin,
    precipitation: day.precipitation ?? 0,
    precipitationProbability: day.precipitationProbability ?? 0,
    windGustMax: day.windGustMax ?? day.windSpeedMax ?? null,
    snowfall: day.snowfall ?? 0
  }));
}

function WeatherIcon({ code, className = "h-10 w-10" }) {
  if ([0].includes(code)) return <Sun className={className + " text-yellow-300"} />;
  if ([1, 2].includes(code)) return <CloudSun className={className + " text-yellow-200"} />;
  if ([3, 45, 48].includes(code)) return <Cloud className={className + " text-slate-300"} />;
  if ([95, 96, 99].includes(code)) return <AlertTriangle className={className + " text-emergency-yellow"} />;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return <Snowflake className={className + " text-sky-200"} />;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return <CloudRain className={className + " text-sky-300"} />;
  return <CloudSun className={className + " text-slate-300"} />;
}

function MetricCard({ icon: Icon, label, value, detail }) {
  return (
    <article className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
        </div>
        <Icon className="h-5 w-5 text-sky-300" />
      </div>
      <p className="mt-2 text-xs text-slate-400">{detail}</p>
    </article>
  );
}

function ForecastControls({ selectedId, setSelectedId, custom, setCustom, days, setDays, onRefresh, loading }) {
  function selectMunicipality(id) {
    setSelectedId(id);
    const item = MUNICIPALITIES.find((municipality) => municipality.id === id);
    if (item) setCustom({ lat: String(item.lat), lng: String(item.lng) });
  }

  return (
    <section className="panel p-4">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr_auto] lg:items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Comune</span>
          <select
            value={selectedId}
            onChange={(event) => selectMunicipality(event.target.value)}
            className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            {MUNICIPALITIES.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>{municipality.name}</option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Latitudine</span>
            <input
              value={custom.lat}
              onChange={(event) => setCustom((current) => ({ ...current, lat: event.target.value }))}
              className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              inputMode="decimal"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Longitudine</span>
            <input
              value={custom.lng}
              onChange={(event) => setCustom((current) => ({ ...current, lng: event.target.value }))}
              className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
              inputMode="decimal"
            />
          </label>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Giorni</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={7}>7</option>
            </select>
          </label>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sky-400/60 bg-sky-400/10 px-4 text-sm font-semibold text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCcw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />
            Aggiorna
          </button>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <Crosshair className="h-4 w-4 text-sky-300" />
        Le coordinate possono essere modificate manualmente per analizzare un punto preciso, anche fuori dal centro del comune selezionato.
      </p>
    </section>
  );
}

function SummarySection({ payload }) {
  const primary = getPrimarySource(payload);
  const hazard = highestHazard(payload?.sources || []);
  const summary = primary?.summary24h || {};

  return (
    <section>
      <div className="panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="section-title">Scenario prossime 24 ore</h2>
            <p className="muted">Sintesi operativa calcolata sulla coordinata selezionata.</p>
          </div>
          <div className={("rounded-lg border px-3 py-2 text-sm " + (HAZARD_STYLE[hazard.level] || HAZARD_STYLE.Verde))}>
            <p className="font-semibold">{hazard.level}</p>
            <p className="text-xs opacity-90">{hazard.label}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={CloudRain} label="Pioggia 24h" value={(summary.rain24h ?? "n.d.") + " mm"} detail="Soglie: 15 / 30 / 50 mm" />
          <MetricCard icon={Wind} label="Raffica max" value={(summary.maxWindGust ?? "n.d.") + " km/h"} detail="Soglie: 50 / 70 / 90 km/h" />
          <MetricCard icon={Thermometer} label="Temperatura" value={(summary.minTemperature ?? "n.d.") + " / " + (summary.maxTemperature ?? "n.d.") + " C"} detail="Minima e massima su 24 ore" />
          <MetricCard icon={Snowflake} label="Neve" value={(summary.snow24h ?? "n.d.") + " cm"} detail="Indicatore utile per Appennino e quote alte" />
        </div>
      </div>
    </section>
  );
}

function ForecastCharts({ payload }) {
  const primary = getPrimarySource(payload);
  const [rainView, setRainView] = useState("hourly");
  const rows = useMemo(() => buildChartRows(primary), [primary]);
  const dailyRows = useMemo(() => buildDailyRows(primary), [primary]);
  const rainRows = rainView === "hourly"
    ? rows.map((row) => ({ ...row, label: row.hour }))
    : dailyRows.map((row) => ({ ...row, label: row.label }));

  if (!rows.length) return null;

  return (
    <section className="grid gap-5 xl:grid-cols-2">
      <div className="panel p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="section-title">Pioggia prevista</h2>
            <p className="muted">Precipitazione prevista da Open-Meteo sulla coordinata selezionata.</p>
          </div>
          <div className="inline-flex rounded-lg border border-emergency-line bg-emergency-panel2 p-1 text-xs">
            <button
              type="button"
              onClick={() => setRainView("hourly")}
              className={"rounded-md px-3 py-2 font-semibold transition " + (rainView === "hourly" ? "bg-sky-400/20 text-sky-100" : "text-slate-400 hover:text-slate-100")}
            >
              Ogni ora
            </button>
            <button
              type="button"
              onClick={() => setRainView("daily")}
              className={"rounded-md px-3 py-2 font-semibold transition " + (rainView === "daily" ? "bg-sky-400/20 text-sky-100" : "text-slate-400 hover:text-slate-100")}
            >
              Per giorno
            </button>
          </div>
        </div>
        <div className="overflow-x-auto pb-2">
          <div className={"h-72 " + (rainView === "hourly" ? "min-w-[80rem]" : "min-w-[44rem]")}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rainRows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit="mm" />
                <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
                <Bar dataKey="precipitation" name={rainView === "hourly" ? "Pioggia oraria" : "Pioggia giornaliera"} fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Temperatura e raffiche</h2>
            <p className="muted">Lettura rapida per soglie operative locali.</p>
          </div>
          <Wind className="h-5 w-5 text-sky-300" />
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="h-72 min-w-[48rem]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperatura C" stroke="#fb923c" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="windGust" name="Raffiche km/h" stroke="#a78bfa" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function DailyTable({ payload }) {
  const primary = getPrimarySource(payload);
  const days = buildDailyRows(primary);
  if (!days.length) return null;

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-emergency-line px-4 py-3">
        <h2 className="section-title">Sintesi giornaliera</h2>
        <p className="muted">Vista grafica Open-Meteo con temperatura massima, minima e probabilita di pioggia.</p>
      </div>
      <div className="overflow-x-auto p-4">
        <div className="min-w-[48rem]">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(" + days.length + ", minmax(7rem, 1fr))" }}>
            {days.map((day, index) => {
              const date = new Date(day.day);
              const dayName = index === 0 ? "Oggi" : date.toLocaleDateString("it-IT", { weekday: "short" });
              const dateLabel = Number.isFinite(date.getTime())
                ? date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
                : day.day;

              return (
                <article key={day.day} className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-4 text-center">
                  <p className="text-lg font-semibold text-white">{dayName}</p>
                  <p className="text-sm text-slate-400">{dateLabel}</p>
                  <div className="mt-4 flex justify-center">
                    <WeatherIcon code={day.weatherCode} />
                  </div>
                  <p className="mt-3 text-sm text-slate-300">{weatherLabel(day.weatherCode)}</p>
                  <p className="mt-3 text-sm text-slate-300">
                    <CloudRain className="mr-1 inline h-4 w-4 text-sky-300" />
                    {day.precipitationProbability ?? "n.d."}%
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-rose-300">max {day.temperatureMax ?? "n.d."} C</p>
                  <p className="mt-2 text-xl font-semibold text-sky-300">min {day.temperatureMin ?? "n.d."} C</p>
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-400">
                    <Moon className="h-4 w-4 text-yellow-200" />
                    notte
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={days} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit="C" />
                <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
                <Legend />
                <Line type="monotone" dataKey="temperatureMax" name="Massima" stroke="#ec4899" strokeWidth={3} dot={{ r: 5, fill: "#ec4899", stroke: "#fbcfe8", strokeWidth: 2 }} />
                <Line type="monotone" dataKey="temperatureMin" name="Minima" stroke="#38bdf8" strokeWidth={3} dot={{ r: 5, fill: "#38bdf8", stroke: "#bae6fd", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}

function RadarSection({ radarPayload, loading }) {
  const openMeteo = radarPayload?.openMeteo;
  const meteoHub = radarPayload?.meteoHub;
  const rows = (openMeteo?.rows || []).slice(0, 28);
  const summary = openMeteo?.summary || {};

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-emergency-line px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <Crosshair className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
            <div>
              <h2 className="section-title">Radar precipitazioni</h2>
              <p className="muted">
                Open-Meteo fornisce nowcasting sulla coordinata selezionata; MeteoHub viene verificato come canale radar asincrono senza bloccare il pannello.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2 text-xs text-slate-400">
            Ultimo aggiornamento: {formatDateTime(radarPayload?.fetchedAt)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.4fr_0.9fr]">
        <div>
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard
              icon={CloudRain}
              label="Pioggia prossime 3h"
              value={(summary.totalNext3h ?? "n.d.") + " mm"}
              detail={"Somma valori Open-Meteo, risoluzione " + (openMeteo?.resolution || "n.d.")}
            />
            <MetricCard
              icon={CloudRain}
              label="Picco 15 min"
              value={(summary.maxPrecipitation ?? "n.d.") + " mm"}
              detail="Intensita massima prevista sul punto"
            />
            <MetricCard
              icon={AlertTriangle}
              label="Indice fulmini"
              value={summary.maxLightningPotential ?? "n.d."}
              detail="Lightning potential index Open-Meteo"
            />
          </div>

          <div className="mt-4 overflow-x-auto pb-2">
            <div className="h-64 min-w-[44rem]">
              {rows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                    <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
                    <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                    <YAxis stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit="mm" />
                    <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
                    <Bar dataKey="precipitation" name="Precipitazione 15 min" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-lg border border-emergency-line bg-emergency-panel2 text-sm text-slate-400">
                  {loading ? "Caricamento radar..." : "Dati radar/nowcasting non disponibili."}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Open-Meteo</p>
            <p className="mt-2 text-sm font-semibold text-slate-100">
              {openMeteo?.available ? "Nowcasting disponibile (" + (openMeteo.resolution || "n.d.") + ")" : "Dato non disponibile"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Non e una immagine radar grezza: e una serie numerica ad alta frequenza utile per leggere intensita e tendenza locale delle precipitazioni.
            </p>
            {openMeteo?.warning && (
              <p className="mt-2 rounded-md border border-emergency-yellow/40 bg-emergency-yellow/10 px-3 py-2 text-xs text-yellow-100">
                {openMeteo.warning}
              </p>
            )}
            {openMeteo?.sourceUrl && (
              <a
                href={openMeteo.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-sky-200 hover:text-white"
              >
                Apri chiamata Open-Meteo
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>

          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">MeteoHub</p>
            <p className="mt-2 text-sm font-semibold text-slate-100">
              {meteoHub?.available ? "Connessione verificata" : "Radar non pronto"}
            </p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{meteoHub?.note || "Verifica MeteoHub in attesa."}</p>
            {!!meteoHub?.requests?.length && (
              <ul className="mt-3 space-y-2 text-xs text-slate-300">
                {meteoHub.requests.map((request) => (
                  <li key={request.id || request.name} className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                    <span className="font-semibold text-slate-100">{request.name}</span>
                    <span className="ml-2 text-slate-400">{request.status}</span>
                  </li>
                ))}
              </ul>
            )}
            <a
              href={meteoHub?.sourceUrl || "https://meteohub.agenziaitaliameteo.it"}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-sky-200 hover:text-white"
            >
              Apri MeteoHub
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function ForecastPage() {
  const [selectedId, setSelectedId] = useState("firenze");
  const [custom, setCustom] = useState({ lat: "43.7696", lng: "11.2558" });
  const [days, setDays] = useState(3);
  const [payload, setPayload] = useState(null);
  const [radarPayload, setRadarPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [radarLoading, setRadarLoading] = useState(false);
  const [error, setError] = useState(null);

  const selectedMunicipality = MUNICIPALITIES.find((item) => item.id === selectedId) || MUNICIPALITIES[0];
  const activeLat = Number(custom.lat);
  const activeLng = Number(custom.lng);
  const coordinatesValid = Number.isFinite(activeLat) && Number.isFinite(activeLng) && Math.abs(activeLat) <= 90 && Math.abs(activeLng) <= 180;

  async function loadForecast() {
    if (!coordinatesValid) {
      setError("Coordinate non valide.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ lat: String(activeLat), lng: String(activeLng), days: String(days) });
      const response = await fetch("/api/forecast?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      setPayload(data);
      if (data.warning) setError(data.warning);
    } catch {
      setError("Previsioni non raggiungibili in questo momento.");
    } finally {
      setLoading(false);
    }
  }

  async function loadRadar() {
    if (!coordinatesValid) return;
    setRadarLoading(true);
    try {
      const params = new URLSearchParams({ lat: String(activeLat), lng: String(activeLng) });
      const response = await fetch("/api/radar?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      setRadarPayload(data);
    } catch {
      setRadarPayload({
        fetchedAt: new Date().toISOString(),
        openMeteo: null,
        meteoHub: { available: false, note: "Radar non raggiungibile in questo momento." }
      });
    } finally {
      setRadarLoading(false);
    }
  }

  useEffect(() => {
    loadForecast();
    loadRadar();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadForecast();
      loadRadar();
    }, DATA_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeLat, activeLng, days, coordinatesValid]);

  return (
    <>
      <AppNav />
      <main className="min-h-screen px-3 py-4 sm:px-5 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          <header className="panel p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wider text-sky-300">Modulo previsionale</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-normal text-white sm:text-3xl">Previsioni meteo puntuali</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-400">
                  Analisi per comune o coordinate precise con Open-Meteo, pensata per uso operativo su desktop, tablet e mobile.
                </p>
              </div>
              <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-300">
                <div className="flex items-center gap-2 text-sky-100">
                  <LocateFixed className="h-4 w-4" />
                  {selectedMunicipality.name}
                </div>
                <p className="mt-1 text-xs text-slate-400">{custom.lat}, {custom.lng}</p>
              </div>
            </div>
          </header>

          <ForecastControls
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            custom={custom}
            setCustom={setCustom}
            days={days}
            setDays={setDays}
            onRefresh={() => {
              loadForecast();
              loadRadar();
            }}
            loading={loading || radarLoading}
          />

          {error && (
            <div className="rounded-lg border border-emergency-orange/50 bg-emergency-orange/10 px-4 py-3 text-sm text-orange-100">
              <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</div>
            </div>
          )}

          {payload ? (
            <>
              <SummarySection payload={payload} />
              <ForecastCharts payload={payload} />
              <DailyTable payload={payload} />
              <RadarSection radarPayload={radarPayload} loading={radarLoading} />
            </>
          ) : (
            <section className="panel flex min-h-60 items-center justify-center p-6 text-sm text-slate-400">
              Caricamento previsioni...
            </section>
          )}

          <section className="panel p-4">
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <div>
                <h2 className="section-title">Soglie locali usate</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Le soglie sono indicatori previsionali di supporto: pioggia 24h a 15/30/50 mm, raffiche a 50/70/90 km/h, neve 24h da 10 cm. Non sostituiscono il bollettino ufficiale di criticita.
                </p>
              </div>
            </div>
          </section>

          <footer className="pb-6 text-xs text-slate-500">
            Fonte previsionale: Open-Meteo. Ultimo aggiornamento: {formatDateTime(payload?.fetchedAt)}.
          </footer>
        </div>
      </main>
    </>
  );
}
