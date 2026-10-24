import { Activity, MapPin } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PageLayout from "@/components/PageLayout";
import stationCatalog from "@/data/_MeteoHub.json";
import { sensorBadgeStyle } from "@/lib/stationTheme";

function getSensorCounts() {
  return Object.fromEntries(
    Object.keys(stationCatalog.sensorLabels).map((sensor) => [
      sensor,
      stationCatalog.stations.filter((station) => station.sensors.includes(sensor)).length
    ])
  );
}

export const metadata = {
  title: "Catalogo stazioni",
  description: "Catalogo consultabile delle stazioni meteo e idrometriche della provincia di Firenze."
};

export default function FirenzeStationsPage() {
  const sensorCounts = getSensorCounts();
  const sortedStations = [...stationCatalog.stations].sort((a, b) => a.name.localeCompare(b.name, "it"));

  return (
      <PageLayout>
        <PageHeader
          eyebrow="Catalogo _MeteoHub"
          title="Stazioni della provincia"
          description="Anagrafica operativa usata dalla dashboard per mappa, selettori e fallback dati, con coordinate e sensori di ogni stazione. L'endpoint tecnico resta disponibile su /api/stations/firenze."
        >
          <div className="rounded-lg border border-emergency-line bg-emergency-panel2 px-4 py-3 md:w-56">
            <p className="text-xs uppercase tracking-wide text-slate-500">Totale stazioni</p>
            <p className="mt-1 text-2xl font-semibold text-white">{stationCatalog.stations.length}</p>
          </div>
        </PageHeader>

        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Object.entries(stationCatalog.sensorLabels).map(([sensor, label]) => (
            <div key={sensor} className="rounded-lg border px-4 py-3" style={sensorBadgeStyle(sensor)}>
              <p className="text-sm font-medium">{label}</p>
              <p className="mt-2 text-2xl font-semibold">{sensorCounts[sensor]}</p>
            </div>
          ))}
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-emergency-line px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-sky-300" />
              <h2 className="section-title">Stazioni georeferenziate</h2>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Coordinate e sensori associati al catalogo _MeteoHub normalizzato per dashboard e mappa.
            </p>
          </div>

          <div className="grid gap-2 p-3 md:hidden">
            {sortedStations.map((station) => (
              <article key={station.id} className="rounded-lg border border-emergency-line bg-black/10 px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium text-white">{station.name}</p>
                  <span className="shrink-0 font-mono text-[10px] text-sky-100">{station.id}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {station.lat.toFixed(5)}, {station.lng.toFixed(5)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {station.sensors.map((sensor) => (
                    <span key={sensor} className="rounded-full border px-2 py-0.5 text-[11px] font-medium" style={sensorBadgeStyle(sensor)}>
                      {stationCatalog.sensorLabels[sensor]}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[920px] border-collapse text-left text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.14em] text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">ID</th>
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">Lat</th>
                  <th className="px-4 py-3 font-semibold">Lng</th>
                  <th className="px-4 py-3 font-semibold">Sensori</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emergency-line">
                {sortedStations.map((station) => (
                  <tr key={station.id} className="hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-sky-100">{station.id}</td>
                    <td className="px-4 py-3 font-medium text-white">{station.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{station.lat.toFixed(5)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{station.lng.toFixed(5)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {station.sensors.map((sensor) => (
                          <span
                            key={sensor}
                            className="rounded-full border px-2.5 py-1 text-xs font-medium"
                            style={sensorBadgeStyle(sensor)}
                          >
                            {stationCatalog.sensorLabels[sensor]}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-4 text-sm text-slate-300">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-5 w-5 text-sky-300" />
            <p>
              Questa vista mantiene solo la consultazione del catalogo. I dati real-time vengono interrogati dalla
              dashboard tramite MeteoHub, cache programmata e fallback Open-Meteo dove applicabile.
            </p>
          </div>
        </section>
      </PageLayout>
  );
}
