"use client";

import { AlertTriangle, CloudRain, Thermometer, Waves } from "lucide-react";

const STATUS_BADGE = {
  Rosso: "border-emergency-red/60 bg-emergency-red/15 text-emergency-red",
  Giallo: "border-emergency-yellow/60 bg-emergency-yellow/15 text-emergency-yellow",
  Verde: "border-emergency-green/50 bg-emergency-green/10 text-emergency-green"
};

// Number(null) vale 0: senza questo controllo una soglia assente diventerebbe
// una soglia a 0 m, cioe' un allarme falso.
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function available(stations) {
  return (stations || []).filter((station) => toFiniteNumber(station?.value) !== null);
}

function statusOf(station) {
  const value = toFiniteNumber(station?.value);
  const danger = toFiniteNumber(station?.danger);
  const warning = toFiniteNumber(station?.warning);
  if (value === null) return null;
  if (danger !== null && value >= danger) return "Rosso";
  if (warning !== null && value >= warning) return "Giallo";
  if (warning === null && danger === null) return null;
  return "Verde";
}

function maxBy(stations, selector) {
  return stations.reduce((best, station) => (best === null || selector(station) > selector(best) ? station : best), null);
}

function minBy(stations, selector) {
  return stations.reduce((best, station) => (best === null || selector(station) < selector(best) ? station : best), null);
}

function formatValue(value, digits = 1) {
  const number = toFiniteNumber(value);
  if (number === null) return "n.d.";
  return number.toLocaleString("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatClock(value) {
  if (!value) return "in attesa";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function SourceChip({ label, updatedAt, ok }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emergency-line bg-emergency-panel2 px-2.5 py-1 text-xs text-slate-300">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? "#22c55e" : "#94a3b8" }} />
      {label}
      <span className="text-slate-500">{ok ? "· " + formatClock(updatedAt) : "· in attesa"}</span>
    </span>
  );
}

function MetricCard({ icon: Icon, iconColor, label, value, unit, detail, badge, badgeClass }) {
  return (
    <article className="min-w-0 rounded-lg border border-emergency-line bg-emergency-panel2/70 px-2.5 py-2.5 sm:px-3 sm:py-3">
      <div className="flex items-center justify-between gap-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" style={{ color: iconColor }} />
      </div>
      <p className="mt-1.5 flex items-baseline gap-1 text-xl font-semibold text-white sm:mt-2 sm:text-2xl">
        {value}
        {unit ? <span className="text-xs font-normal text-slate-400 sm:text-sm">{unit}</span> : null}
      </p>
      <p className="mt-1 truncate text-[11px] text-slate-400 sm:text-xs" title={detail}>{detail}</p>
      {badge ? (
        <p className={"mt-1.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:mt-2 sm:text-[11px] " + badgeClass}>
          {badge}
        </p>
      ) : null}
    </article>
  );
}

// Sintesi delle misure in corso: pochi numeri che rispondono subito a "com'e'
// la situazione adesso", senza dover leggere le tabelle sotto la mappa.
export default function SituationStrip({ measurements = {}, fetchedAt = null, cfrUpdatedAt = null, openMeteoUpdatedAt = null }) {
  const hydro = available(measurements.hydrometry);
  const rain = available(measurements.pluviometry);
  const temperatures = available(measurements.thermometry);

  const highestLevel = maxBy(hydro, (station) => toFiniteNumber(station.value));
  const highestLevelStatus = statusOf(highestLevel);
  const aboveAttention = hydro.filter((station) => statusOf(station) === "Giallo").length;
  const aboveCritical = hydro.filter((station) => statusOf(station) === "Rosso").length;
  const wettest = maxBy(rain, (station) => toFiniteNumber(station.value));
  const coldest = minBy(temperatures, (station) => toFiniteNumber(station.value));
  const warmest = maxBy(temperatures, (station) => toFiniteNumber(station.value));

  const hydroBadge = highestLevelStatus ? highestLevelStatus : highestLevel ? "soglie non disponibili" : null;
  const hydroBadgeClass = highestLevelStatus
    ? STATUS_BADGE[highestLevelStatus]
    : "border-emergency-line bg-black/20 text-slate-400";

  const thresholdBadge = aboveCritical > 0
    ? { text: aboveCritical + " sopra soglia critica", className: STATUS_BADGE.Rosso }
    : aboveAttention > 0
      ? { text: aboveAttention + " sopra soglia attenzione", className: STATUS_BADGE.Giallo }
      : hydro.length
        ? { text: "tutte sotto soglia", className: STATUS_BADGE.Verde }
        : null;

  return (
    <section className="panel p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Stato operativo</p>
          <h2 className="mt-1 text-sm font-medium text-slate-200">Misure in corso sulla provincia</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <SourceChip label="CFR Toscana" updatedAt={cfrUpdatedAt || fetchedAt} ok={Boolean(cfrUpdatedAt || fetchedAt)} />
          <SourceChip label="Open-Meteo" updatedAt={openMeteoUpdatedAt || fetchedAt} ok={Boolean(openMeteoUpdatedAt || fetchedAt)} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3 xl:grid-cols-4">
        <MetricCard
          icon={Waves}
          iconColor="#22c55e"
          label="Livello più alto"
          value={highestLevel ? formatValue(highestLevel.value, 2) : "n.d."}
          unit={highestLevel ? "m" : ""}
          detail={highestLevel ? highestLevel.name : "idrometria non disponibile"}
          badge={hydroBadge}
          badgeClass={hydroBadgeClass}
        />
        <MetricCard
          icon={AlertTriangle}
          iconColor={aboveCritical ? "#ef4444" : "#facc15"}
          label="Stazioni in soglia"
          value={hydro.length ? aboveAttention + aboveCritical : "n.d."}
          unit={hydro.length ? "/ " + hydro.length : ""}
          detail={hydro.length ? "livelli idrometrici monitorati" : "nessun livello disponibile"}
          badge={thresholdBadge ? thresholdBadge.text : null}
          badgeClass={thresholdBadge ? thresholdBadge.className : null}
        />
        <MetricCard
          icon={CloudRain}
          iconColor="#38bdf8"
          label="Pioggia più alta"
          value={wettest ? formatValue(wettest.value, 1) : "n.d."}
          unit={wettest ? "mm" : ""}
          detail={wettest ? wettest.name : "pluviometria non disponibile"}
        />
        <MetricCard
          icon={Thermometer}
          iconColor="#fb923c"
          label="Temperatura"
          value={coldest && warmest ? formatValue(coldest.value, 1) + " – " + formatValue(warmest.value, 1) : "n.d."}
          unit={coldest && warmest ? "C" : ""}
          detail={coldest && warmest ? coldest.name + " · " + warmest.name : "termometria non disponibile"}
        />
      </div>
    </section>
  );
}
