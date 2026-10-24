"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
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
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import LazySection from "@/components/LazySection";
import PageHeader from "@/components/PageHeader";
import PageLayout from "@/components/PageLayout";

const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const RadarDpcMap = dynamic(() => import("@/components/RadarDpcMap"), {
  ssr: false,
  loading: () => (
    <section className="panel flex min-h-96 items-center justify-center p-6 text-sm text-slate-400">
      Caricamento mappa Radar-DPC...
    </section>
  )
});

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

const FORECAST_PROFILES = [
  {
    id: "recommended",
    label: "Consigliato",
    detail: "ARPAE 0-72h, poi ICON/ECMWF con fallback best match"
  },
  {
    id: "arpae",
    label: "ItaliaMeteo ARPAE",
    detail: "ICON-2I, alta risoluzione, breve termine"
  },
  {
    id: "icon",
    label: "DWD ICON",
    detail: "Buon compromesso fino a 7 giorni"
  },
  {
    id: "ecmwf",
    label: "ECMWF IFS/AIFS",
    detail: "Tendenza medio termine"
  },
  {
    id: "best_match",
    label: "Open-Meteo best match",
    detail: "Selezione automatica Open-Meteo"
  }
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

function getItalianDayKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

function formatSelectedDay(value) {
  const date = new Date(value + "T12:00:00");
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function buildWindDayRows(rows, dayKey) {
  const byHour = new Map(
    rows
      .filter((row) => getItalianDayKey(row.date) === dayKey)
      .map((row) => [new Date(row.date).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }), row])
  );

  return Array.from({ length: 25 }, (_, index) => {
    const label = String(index).padStart(2, "0") + ":00";
    const source = byHour.get(label);
    return {
      hour: label,
      windGust: source?.windGust ?? null,
      windDirection: source?.windDirection ?? null
    };
  });
}

function weatherLabel(code) {
  const labels = {
    0: "Sereno",
    1: "Poco nuvoloso",
    2: "Parz. nuvoloso",
    3: "Coperto",
    45: "Nebbia",
    48: "Nebbia gelata",
    51: "Pioviggine debole",
    53: "Pioviggine",
    55: "Pioviggine intensa",
    56: "Pioviggine gelata",
    57: "Pioviggine gelata",
    61: "Pioggia debole",
    63: "Pioggia",
    65: "Pioggia intensa",
    66: "Pioggia gelata",
    67: "Pioggia gelata",
    71: "Neve debole",
    73: "Neve",
    75: "Neve intensa",
    77: "Grani di neve",
    80: "Rovesci deboli",
    81: "Rovesci",
    82: "Rovesci violenti",
    85: "Rovesci neve",
    86: "Rovesci neve",
    95: "Temporale",
    96: "Temporale grandine",
    99: "Temporale grandine"
  };
  return labels[code] || "Meteo";
}

function smartWeatherLabel(day) {
  const probability = Number(day.precipitationProbability) || 0;
  const precipitation = Number(day.precipitation) || 0;
  const snowfall = Number(day.snowfall) || 0;
  const windGust = Number(day.windGustMax) || 0;

  if (snowfall > 0) return "Neve";
  if ([95, 96, 99].includes(day.weatherCode)) return "Temporale";
  if (precipitation >= 20) return "Pioggia intensa";
  if (precipitation >= 5 || probability >= 60) return "Pioggia";
  if ([45, 48].includes(day.weatherCode)) return "Nebbia";
  if (windGust >= 70) return "Vento forte";
  if ([1, 2].includes(day.weatherCode) && probability < 30) return "Variabile";
  return weatherLabel(day.weatherCode);
}

function formatMetric(value, unit = "", decimals = 1) {
  // Number(null) vale 0: una grandezza assente deve restare "n.d.", non
  // diventare uno zero reale (per esempio 0 km di visibilita').
  if (value === null || value === undefined || value === "") return "n.d.";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n.d.";
  const formatted = Number(number.toFixed(decimals));
  if (unit === "%") return formatted + "%";
  return formatted + (unit ? " " + unit : "");
}

function windDirectionLabel(degrees) {
  const number = Number(degrees);
  if (!Number.isFinite(number)) return "n.d.";
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(number / 45) % 8];
}

function highestHazard(sources) {
  const order = { Verde: 0, Giallo: 1, Arancione: 2, Rosso: 3 };
  const hazards = sources.flatMap((source) => source.hazards || []);
  if (!hazards.length) return { level: "Verde", label: "Nessuna soglia superata", detail: "Scenario ordinario sui parametri previsionali" };
  return hazards.sort((a, b) => order[b.level] - order[a.level])[0];
}

function getPrimarySource(payload) {
  return payload?.sources?.find((source) => source.primary) || payload?.sources?.[0] || null;
}

function buildChartRows(primary) {
  const rows = (primary?.hourly || []).map((point) => ({
    hour: point.hour,
    date: point.time,
    precipitation: point.precipitation ?? 0,
    rain: point.rain ?? 0,
    showers: point.showers ?? 0,
    temperature: point.temperature,
    apparentTemperature: point.apparentTemperature,
    windGust: point.windGust,
    windDirection: point.windDirection,
    probability: point.precipitationProbability,
    humidity: point.humidity,
    visibility: point.visibility,
    cloudCover: point.cloudCover,
    snow: point.snowfall ?? 0,
    snowDepth: point.snowDepth ?? 0
  }));
  return rows;
}

function buildDailyRows(primary) {
  const currentWeatherCode = primary?.current?.weather_code ?? null;
  return (primary?.daily || []).map((day) => ({
    day: day.day,
    label: formatDay(day.day),
    weatherCode: day.day === primary?.daily?.[0]?.day ? currentWeatherCode ?? day.weatherCode : day.weatherCode,
    temperatureMax: day.temperatureMax,
    temperatureMin: day.temperatureMin,
    precipitation: day.precipitation ?? 0,
    rain: day.rain ?? 0,
    precipitationProbability: day.precipitationProbability ?? 0,
    uvIndexMax: day.uvIndexMax ?? null,
    windGustMax: day.windGustMax ?? day.windSpeedMax ?? null,
    windDirection: day.windDirection ?? null,
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

function ForecastControls({
  selectedId,
  setSelectedId,
  custom,
  setCustom,
  days,
  setDays,
  forecastProfile,
  setForecastProfile,
  onRefresh,
  loading
}) {
  const selectedProfile = FORECAST_PROFILES.find((profile) => profile.id === forecastProfile) || FORECAST_PROFILES[0];

  function selectMunicipality(id) {
    setSelectedId(id);
    const item = MUNICIPALITIES.find((municipality) => municipality.id === id);
    if (item) setCustom({ lat: String(item.lat), lng: String(item.lng) });
  }

  return (
    <section className="panel p-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_0.95fr_auto] xl:items-end">
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Fonte meteo</span>
          <select
            value={forecastProfile}
            onChange={(event) => setForecastProfile(event.target.value)}
            className="min-h-11 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-400"
          >
            {FORECAST_PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label}</option>
            ))}
          </select>
          <span className="text-[11px] leading-4 text-slate-500">{selectedProfile.detail}</span>
        </label>

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
  const currentHumidity = primary?.current?.relative_humidity_2m ?? null;
  const hasSnowSignal = Number(summary.snow24h) > 0 || Number(summary.maxSnowDepth) > 0;

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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard icon={CloudRain} label="Pioggia 24h" value={formatMetric(summary.rain24h, "mm")} detail={"Rovesci: " + formatMetric(summary.showers24h, "mm")} />
          <MetricCard icon={CloudRain} label="Prob. pioggia" value={formatMetric(summary.maxPrecipitationProbability, "%", 0)} detail="Massima probabilita oraria" />
          <MetricCard icon={Wind} label="Raffica max" value={formatMetric(summary.maxWindGust, "km/h")} detail={"Direzione: " + windDirectionLabel(summary.maxWindDirection)} />
          <MetricCard icon={Thermometer} label="Percepita" value={formatMetric(summary.minApparentTemperature, "C") + " / " + formatMetric(summary.maxApparentTemperature, "C")} detail="Minima e massima percepita" />
          <MetricCard icon={Cloud} label="UMIDITA'" value={formatMetric(currentHumidity, "%", 0)} detail="Dato corrente Open-Meteo" />
          <MetricCard icon={Crosshair} label="Visibilita min" value={formatMetric(summary.minVisibility, "km")} detail="Utile per nebbia e rovesci" />
        </div>

        {hasSnowSignal && (
          <div className="mt-4 rounded-lg border border-sky-300/40 bg-sky-400/10 p-3 text-sm text-sky-100">
            <div className="flex items-start gap-3">
              <Snowflake className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Segnale neve/Appennino</p>
                <p className="mt-1 text-xs leading-5 text-sky-100/80">
                  Neve prevista 24h: {formatMetric(summary.snow24h, "cm")}. Altezza neve massima stimata: {formatMetric(summary.maxSnowDepth, "m")}.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ForecastCharts({ payload }) {
  const primary = getPrimarySource(payload);
  const [rainView, setRainView] = useState("hourly");
  const [windDayIndex, setWindDayIndex] = useState(0);
  const rows = useMemo(() => buildChartRows(primary), [primary]);
  const dailyRows = useMemo(() => buildDailyRows(primary), [primary]);
  const windDayKeys = useMemo(() => [...new Set(rows.map((row) => getItalianDayKey(row.date)).filter(Boolean))].slice(0, 7), [rows]);
  const selectedWindDayKey = windDayKeys[Math.min(windDayIndex, Math.max(windDayKeys.length - 1, 0))] || windDayKeys[0];
  const windRows = useMemo(() => buildWindDayRows(rows, selectedWindDayKey), [rows, selectedWindDayKey]);
  const windMax = Math.max(0, ...windRows.map((row) => Number(row.windGust) || 0));
  const windDomainMax = Math.max(100, Math.ceil((windMax + 10) / 10) * 10);
  const windPeakRow = windRows
    .filter((row) => Number.isFinite(Number(row.windGust)))
    .sort((a, b) => Number(b.windGust) - Number(a.windGust))[0];
  const rainRows = rainView === "hourly"
    ? rows.slice(0, 24).map((row) => ({ ...row, label: row.hour }))
    : dailyRows.map((row) => ({ ...row, label: row.label, probability: row.precipitationProbability }));
  const rainMax = Math.max(0, ...rainRows.map((row) => Number(row.precipitation) || 0));
  const rainDomainMax = Math.max(110, Math.ceil((rainMax + 10) / 10) * 10);

  useEffect(() => {
    if (windDayIndex > Math.max(windDayKeys.length - 1, 0)) {
      setWindDayIndex(Math.max(windDayKeys.length - 1, 0));
    }
  }, [windDayIndex, windDayKeys.length]);

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
          <div className={"h-72 " + (rainView === "hourly" ? "min-w-[48rem]" : "min-w-[44rem]")}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rainRows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} />
                <YAxis yAxisId="left" domain={[0, rainDomainMax]} stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit="mm" />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="#c4b5fd" tick={{ fill: "#c4b5fd", fontSize: 12 }} unit="%" />
                <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
                <Legend />
                <ReferenceLine yAxisId="left" y={10} stroke="#facc15" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
                <ReferenceLine yAxisId="left" y={50} stroke="#fb923c" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
                <ReferenceLine yAxisId="left" y={100} stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
                <Bar yAxisId="left" dataKey="precipitation" name={rainView === "hourly" ? "Pioggia oraria mm" : "Pioggia giornaliera mm"} fill="#38bdf8" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="probability" name="Probabilita pioggia %" stroke="#a78bfa" strokeWidth={2} dot={{ r: 4, fill: "#a78bfa", stroke: "#ddd6fe", strokeWidth: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
          <span className="inline-flex items-center gap-2 text-yellow-200"><span className="h-1 w-8 rounded-full bg-yellow-400" />soglia 10 mm</span>
          <span className="inline-flex items-center gap-2 text-orange-200"><span className="h-1 w-8 rounded-full bg-orange-400" />soglia 50 mm</span>
          <span className="inline-flex items-center gap-2 text-red-200"><span className="h-1 w-8 rounded-full bg-red-500" />soglia 100 mm</span>
          <span className="inline-flex items-center gap-2 text-violet-200"><span className="h-1 w-8 rounded-full bg-violet-400" />probabilita pioggia</span>
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="section-title">Raffiche previste</h2>
            <p className="muted">Lettura giornaliera con soglie operative locali.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWindDayIndex((current) => Math.max(0, current - 1))}
              disabled={windDayIndex <= 0}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emergency-line bg-emergency-panel2 text-sm font-semibold text-slate-200 transition hover:border-sky-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Giorno precedente"
            >
              {"<"}
            </button>
            <div className="min-w-44 rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-2 text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Giorno</p>
              <p className="text-sm font-semibold capitalize text-slate-100">{formatSelectedDay(selectedWindDayKey)}</p>
            </div>
            <button
              type="button"
              onClick={() => setWindDayIndex((current) => Math.min(windDayKeys.length - 1, current + 1))}
              disabled={windDayIndex >= windDayKeys.length - 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emergency-line bg-emergency-panel2 text-sm font-semibold text-slate-200 transition hover:border-sky-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Giorno successivo"
            >
              {">"}
            </button>
            <Wind className="hidden h-5 w-5 text-sky-300 sm:block" />
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={windRows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <CartesianGrid stroke="#26364f" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="#94a3b8" interval={2} tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis domain={[0, windDomainMax]} stroke="#94a3b8" tick={{ fill: "#94a3b8", fontSize: 12 }} unit=" km/h" />
              <Tooltip contentStyle={{ background: "#0d1728", border: "1px solid #26364f", borderRadius: 8 }} labelStyle={{ color: "#e2e8f0" }} />
              <ReferenceLine y={50} stroke="#facc15" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
              <ReferenceLine y={70} stroke="#fb923c" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
              <ReferenceLine y={90} stroke="#ef4444" strokeWidth={2} strokeDasharray="6 4" ifOverflow="extendDomain" />
              <Line type="monotone" dataKey="windGust" name="Raffiche km/h" stroke="#a78bfa" strokeWidth={3} dot={{ r: 3, fill: "#a78bfa", stroke: "#ddd6fe", strokeWidth: 1 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
          <span className="inline-flex items-center gap-2 text-yellow-200"><span className="h-1 w-8 rounded-full bg-yellow-400" />soglia 50 km/h</span>
          <span className="inline-flex items-center gap-2 text-orange-200"><span className="h-1 w-8 rounded-full bg-orange-400" />soglia 70 km/h</span>
          <span className="inline-flex items-center gap-2 text-red-200"><span className="h-1 w-8 rounded-full bg-red-500" />soglia 90 km/h</span>
          <span className="inline-flex items-center gap-2 text-sky-200">direzione raffica max: {windDirectionLabel(windPeakRow?.windDirection)}</span>
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
        <p className="muted">Vista grafica Open-Meteo con scenario dedotto da codice meteo, pioggia, neve, vento e probabilita.</p>
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
              const scenarioLabel = smartWeatherLabel(day);

              return (
                <article key={day.day} className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-4 text-center">
                  <p className="text-lg font-semibold text-white">{dayName}</p>
                  <p className="text-sm text-slate-400">{dateLabel}</p>
                  <div className="mt-4 flex justify-center">
                    <WeatherIcon code={day.weatherCode} />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-200">{scenarioLabel}</p>
                  <p className="mt-3 text-sm text-slate-300">
                    <CloudRain className="mr-1 inline h-4 w-4 text-sky-300" />
                    {day.precipitationProbability ?? "n.d."}% - {formatMetric(day.precipitation, "mm")}
                  </p>
                  <p className="mt-3 text-2xl font-semibold text-rose-300">max {day.temperatureMax ?? "n.d."} C</p>
                  <p className="mt-2 text-xl font-semibold text-sky-300">min {day.temperatureMin ?? "n.d."} C</p>
                  <p className="mt-2 text-sm font-semibold text-yellow-200">UV {formatMetric(day.uvIndexMax, "", 1)}</p>
                  <p className="mt-3 text-xs text-slate-400">
                    Raffica {formatMetric(day.windGustMax, "km/h")} - {windDirectionLabel(day.windDirection)}
                  </p>
                  {Number(day.snowfall) > 0 && (
                    <p className="mt-2 text-xs font-semibold text-sky-200">Neve {formatMetric(day.snowfall, "cm")}</p>
                  )}
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

const RADAR_PRODUCTS_FALLBACK = [
  { id: "SRI", label: "Intensita pioggia", shortLabel: "SRI", unit: "mm/h", cadence: "5 min", mapEnabled: true, tileProduct: "SRI" },
  { id: "SRT1", label: "Pioggia cumulata 1h", shortLabel: "SRT1", unit: "mm", cadence: "30 min", mapEnabled: true, tileProduct: "SRT1" },
  { id: "VMI", label: "Massima intensita verticale", shortLabel: "VMI", unit: "dBZ", cadence: "5 min", mapEnabled: true, tileProduct: "VMI" },
  { id: "POH", label: "Probabilita grandine", shortLabel: "POH", unit: "%", cadence: "5 min", mapEnabled: true, tileProduct: "POH" },
  { id: "VIL", label: "Acqua integrata verticale", shortLabel: "VIL", unit: "kg/m2", cadence: "5 min", mapEnabled: true, tileProduct: "VIL" }
];

function buildDpcWmsImageUrl(product, time) {
  if (!product?.wmsLayer) return null;
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: product.wmsLayer,
    styles: "",
    format: "image/png",
    transparent: "true",
    tiled: "true",
    width: "1100",
    height: "720",
    srs: "EPSG:3857",
    bbox: "1046400,5190000,1402600,5590000"
  });
  if (time) params.set("time", time);
  return (product.wmsBaseUrl || "https://radar-geowebcache.protezionecivile.it/service/wms") + "?" + params.toString();
}

function RadarLegend({ product }) {
  const items = product?.id === "SRI"
    ? [
        { label: "0-1 mm/h", color: "bg-sky-300" },
        { label: "1-5 mm/h", color: "bg-emerald-300" },
        { label: "5-20 mm/h", color: "bg-yellow-300" },
        { label: "> 20 mm/h", color: "bg-rose-400" }
      ]
    : [
        { label: "Basso", color: "bg-sky-300" },
        { label: "Moderato", color: "bg-yellow-300" },
        { label: "Elevato", color: "bg-orange-400" },
        { label: "Molto elevato", color: "bg-rose-400" }
      ];

  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 rounded-md border border-emergency-line bg-emergency-panel px-2 py-2 text-slate-300">
          <span className={"h-2.5 w-5 rounded-full " + item.color} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

function RadarSection({ radarPayload, loading, selectedProduct, onProductChange, onRefresh }) {
  const products = radarPayload?.products?.length ? radarPayload.products : RADAR_PRODUCTS_FALLBACK;
  const product = radarPayload?.product || products.find((item) => item.id === selectedProduct) || products[0];
  const lastProduct = radarPayload?.lastProduct;
  const wmsImageUrl = buildDpcWmsImageUrl(product, lastProduct?.wmsTime);
  const [radarImageFailed, setRadarImageFailed] = useState(false);
  const restUrl = product?.restLastUrl || "https://radar-api.protezionecivile.it/findLastProductByType?type=SRI";
  const capabilitiesUrl = radarPayload?.services?.wmsCapabilities || product?.wmsCapabilitiesUrl || "https://radar-geowebcache.protezionecivile.it/service/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=getcapabilities&TILED=true";
  const errorMessage = radarPayload?.errors?.[0]?.message;
  const radarTimeLabel = lastProduct?.date ? formatDateTime(lastProduct.date) : "ultimo layer WMS disponibile";

  useEffect(() => {
    setRadarImageFailed(false);
  }, [wmsImageUrl]);

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-emergency-line px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <Crosshair className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
            <div>
              <h2 className="section-title">Radar DPC precipitazioni</h2>
              <p className="muted">
                Mappa operativa basata sui servizi Radar-DPC della Protezione Civile: metadati REST e layer WMS dove disponibile.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-sky-400/60 bg-sky-400/10 px-3 text-xs font-semibold text-sky-100 transition hover:bg-sky-400/20 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCcw className={"h-3.5 w-3.5 " + (loading ? "animate-spin" : "")} />
              Aggiorna radar
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-emergency-line bg-emergency-panel2/60 px-4 py-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {products.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onProductChange(item.id)}
              className={"shrink-0 rounded-md border px-3 py-2 text-left text-xs transition " +
                (selectedProduct === item.id
                  ? "border-sky-300 bg-sky-400/20 text-sky-50"
                  : "border-emergency-line bg-emergency-panel text-slate-400 hover:text-slate-100")}
            >
              <span className="block font-semibold">{item.shortLabel || item.id}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="space-y-4">
          <div className="relative overflow-hidden rounded-lg border border-emergency-line bg-[#07101d]">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.10)_1px,transparent_1px),linear-gradient(0deg,rgba(148,163,184,0.10)_1px,transparent_1px)] bg-[size:72px_72px]">
              <div className="absolute left-[48%] top-[48%] rounded-md border border-sky-300/40 bg-sky-950/80 px-2 py-1 text-xs font-semibold text-sky-100">Firenze</div>
              <div className="absolute left-[30%] top-[39%] rounded-md border border-slate-500/40 bg-slate-950/75 px-2 py-1 text-xs text-slate-200">Prato</div>
              <div className="absolute left-[66%] top-[63%] rounded-md border border-slate-500/40 bg-slate-950/75 px-2 py-1 text-xs text-slate-200">Arezzo</div>
              <div className="absolute left-[12%] top-[72%] rounded-md border border-slate-500/40 bg-slate-950/75 px-2 py-1 text-xs text-slate-200">Toscana</div>
            </div>
            <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-sky-400/40 bg-sky-950/80 px-2 py-1 font-semibold text-sky-100">
                {product?.wmsLayer || "Metadati REST"}
              </span>
              <span className="rounded-md border border-emergency-line bg-emergency-panel/90 px-2 py-1 text-slate-300">
                Ora radar: {radarTimeLabel}
              </span>
            </div>

            {wmsImageUrl && !radarImageFailed ? (
              <a href={wmsImageUrl} target="_blank" rel="noreferrer" className="relative z-[1] block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={wmsImageUrl}
                  alt={"Radar DPC " + (product?.label || "precipitazioni")}
                  className="h-[22rem] w-full object-cover opacity-90 sm:h-[30rem]"
                  onError={() => setRadarImageFailed(true)}
                />
              </a>
            ) : (
              <div className="relative z-[1] flex h-[22rem] flex-col items-center justify-center gap-3 px-6 text-center sm:h-[30rem]">
                <CloudRain className="h-12 w-12 text-sky-300" />
                <div>
                  <p className="font-semibold text-slate-100">
                    {loading ? "Caricamento radar DPC..." : radarImageFailed ? "Immagine WMS non caricata" : "Layer cartografico non disponibile per questo prodotto"}
                  </p>
                  <p className="mt-2 max-w-xl text-sm text-slate-400">
                    {radarImageFailed ? "Apri il link WMS per verificare se il servizio DPC ha restituito un errore XML o un layer non disponibile." : "Il prodotto selezionato viene interrogato via REST. Per visualizzarlo su mappa serve un layer WMS DPC associato."}
                  </p>
                </div>
                {wmsImageUrl && (
                  <a
                    href={wmsImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
                  >
                    Apri immagine WMS
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
                {errorMessage && (
                  <p className="rounded-md border border-emergency-orange/50 bg-emergency-orange/10 px-3 py-2 text-xs text-orange-100">
                    {errorMessage}
                  </p>
                )}
              </div>
            )}

            <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-emergency-line bg-emergency-panel/90 p-3 backdrop-blur">
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legenda operativa</p>
                <p className="text-xs text-slate-400">Servizio WMS GeoWebCache, vista Toscana centrale</p>
              </div>
              <RadarLegend product={product} />
            </div>
          </div>

          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3">
            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>{formatDateTime(lastProduct?.createdAt || radarPayload?.fetchedAt)}</span>
              <span>{formatDateTime(lastProduct?.updatedAt || radarPayload?.fetchedAt)}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-emergency-panel">
              <div className="h-2 w-full rounded-full bg-gradient-to-r from-sky-500 via-yellow-300 to-rose-500" />
            </div>
            <p className="mt-2 text-xs text-slate-400">Barra temporale del prodotto piu recente disponibile. La navigazione storica potra essere agganciata al download DPC per data.</p>
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Prodotto DPC</p>
            <p className="mt-2 text-lg font-semibold text-slate-100">{product?.label || "Radar DPC"}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{product?.description || "Prodotto radar Protezione Civile."}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Cadenza</p>
                <p className="mt-1 font-semibold text-slate-100">{product?.cadence || "n.d."}</p>
              </div>
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Unita</p>
                <p className="mt-1 font-semibold text-slate-100">{product?.unit || "n.d."}</p>
              </div>
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Qualita</p>
                <p className="mt-1 font-semibold text-slate-100">{lastProduct?.quality ?? "n.d."}</p>
              </div>
              <div className="rounded-md border border-emergency-line bg-emergency-panel px-3 py-2">
                <p className="uppercase text-slate-500">Campioni</p>
                <p className="mt-1 font-semibold text-slate-100">{lastProduct?.dataCount ?? "n.d."}</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Fonti ufficiali</p>
            <p className="mt-2 text-sm font-semibold text-slate-100">Protezione Civile - Radar DPC</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Il pannello usa il REST per sapere quale sia il dato piu recente disponibile e il WMS per comporre la mappa. I prodotti senza layer WMS certo restano consultabili come metadati.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={restUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
              >
                Ultimo prodotto
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <a
                href={capabilitiesUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-400/20"
              >
                WMS capabilities
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            {errorMessage && (
              <p className="mt-3 rounded-md border border-emergency-orange/50 bg-emergency-orange/10 px-3 py-2 text-xs text-orange-100">
                {errorMessage}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-emergency-yellow/40 bg-emergency-yellow/10 p-4 text-xs leading-5 text-yellow-100">
            Il radar DPC e un supporto previsionale/osservativo. Per decisioni operative resta centrale il bollettino ufficiale di allerta e il monitoraggio CFR per idrometria.
            <a
              href="https://dpc-radar.readthedocs.io/it/latest/index.html"
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 font-semibold text-sky-100 hover:text-white"
            >
              Documentazione DPC Radar
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
  const [forecastProfile, setForecastProfile] = useState("recommended");
  const [payload, setPayload] = useState(null);
  const [radarPayload, setRadarPayload] = useState(null);
  const [radarProduct, setRadarProduct] = useState("SRI");
  const [loading, setLoading] = useState(false);
  const [radarLoading, setRadarLoading] = useState(false);
  const [error, setError] = useState(null);

  const selectedMunicipality = MUNICIPALITIES.find((item) => item.id === selectedId) || MUNICIPALITIES[0];
  const activeLat = Number(custom.lat);
  const activeLng = Number(custom.lng);
  const coordinatesValid = Number.isFinite(activeLat) && Number.isFinite(activeLng) && Math.abs(activeLat) <= 90 && Math.abs(activeLng) <= 180;
  const primarySource = getPrimarySource(payload);

  async function loadForecast() {
    if (!coordinatesValid) {
      setError("Coordinate non valide.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: String(activeLat),
        lng: String(activeLng),
        days: String(days),
        profile: forecastProfile
      });
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

  async function loadRadar(productId = radarProduct) {
    setRadarLoading(true);
    try {
      const params = new URLSearchParams({ product: productId });
      const response = await fetch("/api/radar?" + params.toString(), { cache: "no-store" });
      const data = await response.json();
      setRadarPayload(data);
    } catch {
      setRadarPayload({
        fetchedAt: new Date().toISOString(),
        product: RADAR_PRODUCTS_FALLBACK.find((item) => item.id === productId) || RADAR_PRODUCTS_FALLBACK[0],
        products: RADAR_PRODUCTS_FALLBACK,
        lastProduct: null,
        errors: [{ source: "DPC Radar", message: "Radar DPC non raggiungibile in questo momento." }]
      });
    } finally {
      setRadarLoading(false);
    }
  }

  function handleRadarProductChange(productId) {
    setRadarProduct(productId);
    loadRadar(productId);
  }

  useEffect(() => {
    loadRadar();
  }, []);

  useEffect(() => {
    loadForecast();
  }, [activeLat, activeLng, days, coordinatesValid, forecastProfile]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadForecast();
      loadRadar(radarProduct);
    }, DATA_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeLat, activeLng, days, coordinatesValid, forecastProfile, radarProduct]);

  return (
      <PageLayout>
          <PageHeader
            eyebrow="Modulo previsionale"
            title="Previsioni meteo puntuali"
            description="Analisi per comune o coordinate precise con Open-Meteo, pensata per uso operativo su desktop, tablet e mobile."
          >
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-3 py-2 text-sm text-slate-300 md:w-56">
              <div className="flex items-center gap-2 text-sky-100">
                <LocateFixed className="h-4 w-4" />
                {selectedMunicipality.name}
              </div>
              <p className="mt-1 text-xs text-slate-400">{custom.lat}, {custom.lng}</p>
            </div>
          </PageHeader>

          <ForecastControls
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            custom={custom}
            setCustom={setCustom}
            days={days}
            setDays={setDays}
            forecastProfile={forecastProfile}
            setForecastProfile={setForecastProfile}
            onRefresh={() => {
              loadForecast();
              loadRadar(radarProduct);
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
              <LazySection minHeight="22rem" label="I grafici si caricano scorrendo…">
                <ForecastCharts payload={payload} />
              </LazySection>
              <DailyTable payload={payload} />
              <LazySection minHeight="26rem" label="Il radar si carica scorrendo…">
                <RadarDpcMap
                  radarPayload={radarPayload}
                  loading={radarLoading}
                  selectedProduct={radarProduct}
                  onProductChange={handleRadarProductChange}
                  onRefresh={() => loadRadar(radarProduct)}
                />
              </LazySection>
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
                  Le soglie sono indicatori previsionali di supporto: scenario pioggia 24h a 15/30/50 mm, grafico pioggia a 10/50/100 mm, raffiche a 50/70/90 km/h, neve 24h da 10 cm. Non sostituiscono il bollettino ufficiale di criticita.
                </p>
              </div>
            </div>
          </section>

          <footer className="pb-6 text-xs text-slate-500">
            Fonte previsionale: {primarySource?.label || "Open-Meteo"}{primarySource?.model ? " (" + primarySource.model + ")" : ""}. Radar: Protezione Civile DPC. Ultimo aggiornamento: {formatDateTime(payload?.fetchedAt)}.
          </footer>
      </PageLayout>
  );
}
