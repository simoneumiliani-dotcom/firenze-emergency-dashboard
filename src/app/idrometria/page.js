"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, History, MapPin, RefreshCcw, Waves } from "lucide-react";
import AppNav from "@/components/AppNav";

function formatTime(value) {
  if (!value) return "n.d.";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
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

function StationList({ stations, selectedId, onSelect }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-emergency-line px-4 py-3">
        <div className="flex items-center gap-3">
          <MapPin className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Anagrafica stazioni</h2>
            <p className="muted">Idrometri attivi in provincia di Firenze, integrati con anagrafica SIR quando disponibile.</p>
          </div>
        </div>
        <span className="rounded-md border border-emergency-line bg-emergency-panel2 px-3 py-1 text-sm text-sky-100">{stations.length}</span>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        {stations.map((station) => (
          <button
            key={station.station_id}
            type="button"
            onClick={() => onSelect(station.station_id)}
            className={"grid w-full gap-2 border-b border-emergency-line px-4 py-3 text-left hover:bg-white/[0.04] " +
              (selectedId === station.station_id ? "bg-sky-400/10" : "")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">{station.station_code}</p>
                <h3 className="text-sm font-semibold text-slate-100">{station.station_name}</h3>
              </div>
              <span className="rounded-full border border-emergency-line px-2 py-1 text-xs text-slate-300">{station.basin || "bacino n.d."}</span>
            </div>
            <p className="text-xs text-slate-400">{station.municipality || "Comune n.d."} · zona {station.alert_zone || "n.d."}</p>
            <p className="text-xs text-slate-500">lat {station.latitude ?? "n.d."}, lon {station.longitude ?? "n.d."}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function RealtimeTable({ rows }) {
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
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-emergency-line text-sm">
          <thead className="bg-emergency-panel2 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Stazione</th>
              <th className="px-4 py-3">Livello</th>
              <th className="px-4 py-3">Portata</th>
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
                <td className="px-4 py-3 text-slate-400">{formatTime(row.measurement_time)}</td>
                <td className="px-4 py-3 text-orange-100">no</td>
              </tr>
            )) : (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={5}>Realtime non disponibile nel caricamento corrente.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalPanel({ station, rows, loading, error, onLoad }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-emergency-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <History className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Storico SIR</h2>
            <p className="muted">Serie storica collegata alla stazione selezionata, da caricare solo su richiesta.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLoad}
          disabled={!station || loading}
          className="inline-flex items-center justify-center rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Caricamento..." : "Carica storico"}
        </button>
      </div>
      <div className="p-4">
        <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-3 text-sm">
          <p className="font-semibold text-slate-100">{station?.station_name || "Nessuna stazione selezionata"}</p>
          <p className="mt-1 text-slate-400">Risorsa storico: {station?.historical_url || "non disponibile"}</p>
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
      if (!selectedStationId && data.stations?.length) {
        const firstHistorical = data.stations.find((station) => station.historical_url) || data.stations[0];
        setSelectedStationId(firstHistorical.station_id);
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
      setPayload((current) => ({
        ...(current || data),
        historicalMeasurements: data.historicalMeasurements || [],
        counts: {
          ...(current?.counts || data.counts || {}),
          historical: data.historicalMeasurements?.length || 0
        }
      }));
    } catch (err) {
      setHistoricalError(err?.message || String(err));
    } finally {
      setHistoricalLoading(false);
    }
  }

  const selectedStation = useMemo(
    () => payload?.stations?.find((station) => station.station_id === selectedStationId) || null,
    [payload, selectedStationId]
  );

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

          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Stazioni</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.stations ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Realtime CFR</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.realtime ?? 0}</p>
              <p className="mt-1 text-xs text-slate-400">Tentate: {payload?.realtimeDiagnostics?.attemptedStations ?? 0}</p>
            </div>
            <div className="rounded-lg border border-emergency-line bg-emergency-panel2 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Storico caricato</p>
              <p className="mt-2 text-2xl font-semibold text-white">{payload?.counts?.historical ?? 0}</p>
            </div>
          </section>

          <SourceMatrix items={payload?.sourceMatrix || []} />

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <StationList stations={payload?.stations || []} selectedId={selectedStationId} onSelect={setSelectedStationId} />
            <div className="flex flex-col gap-5">
              <RealtimeTable rows={payload?.realtimeMeasurements || []} />
              <HistoricalPanel station={selectedStation} rows={payload?.historicalMeasurements || []} loading={historicalLoading} error={historicalError} onLoad={() => loadHistorical(selectedStationId)} />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
