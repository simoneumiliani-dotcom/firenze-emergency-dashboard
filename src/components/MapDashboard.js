"use client";

import { useEffect, useState } from "react";
import { Layers, MapPin } from "lucide-react";
import L from "leaflet";
import {
  CircleMarker,
  GeoJSON,
  LayersControl,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  WMSTileLayer
} from "react-leaflet";
import { MEASUREMENT_TYPES } from "@/lib/cfrStations";

const FLORENCE_CENTER = [43.82, 11.25];

const TYPE_COLORS = {
  pluviometry: "#38bdf8",
  hydrometry: "#22c55e",
  thermometry: "#fb923c",
  anemometry: "#a78bfa",
  hygrometry: "#14b8a6",
  nivometry: "#facc15"
};

const WMS_LAYERS = [
  {
    key: "flood",
    label: "Pericolosita idraulica - Direttiva Alluvioni",
    url: process.env.NEXT_PUBLIC_WMS_ALLUVIONI_URL || "https://www502.regione.toscana.it/geoscopio_qg/cgi-bin/qgis_mapserv.fcgi",
    layers: process.env.NEXT_PUBLIC_WMS_ALLUVIONI_LAYER || "pericolosita_idraulica",
    opacity: 0.48
  },
  {
    key: "seismic",
    label: "Rischio sismico",
    url: process.env.NEXT_PUBLIC_WMS_SISMICA_URL || "https://www502.regione.toscana.it/geoscopio_qg/cgi-bin/qgis_mapserv.fcgi",
    layers: process.env.NEXT_PUBLIC_WMS_SISMICA_LAYER || "classificazione_sismica",
    opacity: 0.42
  }
];

function getHydroStatus(station) {
  const value = Number(station.value);
  const danger = Number(station.danger);
  const warning = Number(station.warning);
  if (station.value === null || station.value === undefined) return { color: "#64748b", label: "Dato non disponibile" };
  if (Number.isFinite(value) && Number.isFinite(danger) && value >= danger) return { color: "#ef4444", label: "Soglia critica" };
  if (Number.isFinite(value) && Number.isFinite(warning) && value >= warning) return { color: "#facc15", label: "Soglia attenzione" };
  return { color: "#22c55e", label: "Regolare" };
}

function stationColor(station) {
  const visibleMeasurement = station.measurements?.[0] || station;
  if (visibleMeasurement.type === "hydrometry") return getHydroStatus(visibleMeasurement).color;
  return TYPE_COLORS[visibleMeasurement.type] || "#38bdf8";
}

function stationIcon(station) {
  const color = stationColor(station);
  const borderStyle = station.approximate ? "2px dashed #07111f" : "3px solid #07111f";

  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: ${color};
        border: ${borderStyle};
        box-shadow: 0 0 0 3px color-mix(in srgb, ${color} 24%, transparent), 0 8px 18px rgba(0,0,0,.45);
      "></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10]
  });
}

function mergeStations(stations) {
  const map = new Map();

  stations.forEach((station) => {
    if (!station.lat || !station.lng) return;
    const current = map.get(station.id);
    if (!current) {
      map.set(station.id, { ...station, measurements: [station] });
      return;
    }
    current.measurements.push(station);
    if (station.type === "hydrometry") {
      map.set(station.id, { ...current, ...station, measurements: current.measurements });
    }
  });

  return [...map.values()];
}

export default function MapDashboard({ stations = [] }) {
  const [mounted, setMounted] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState(Object.keys(MEASUREMENT_TYPES));
  const [riskLayers, setRiskLayers] = useState([]);
  const [visibleRiskLayers, setVisibleRiskLayers] = useState([]);
  const mapStations = mergeStations(stations)
    .map((station) => ({
      ...station,
      measurements: station.measurements.filter((item) => visibleTypes.includes(item.type))
    }))
    .filter((station) => station.measurements.length);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/risk-layers", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return;
        setRiskLayers(payload.layers || []);
        setVisibleRiskLayers((payload.layers || []).map((layer) => layer.id));
      })
      .catch(() => {
        if (active) setRiskLayers([]);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-emergency-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-sky-300" />
          <div>
            <h2 className="section-title">Mappa rischi e stazioni</h2>
            <p className="text-xs text-slate-400">Stazioni CFR Toscana filtrabili per i sei livelli di monitoraggio.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-slate-300">
          {Object.entries(MEASUREMENT_TYPES).map(([type, meta]) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                setVisibleTypes((current) => current.includes(type)
                  ? current.filter((item) => item !== type)
                  : [...current, type]);
              }}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 transition ${visibleTypes.includes(type) ? "border-sky-400/70 bg-sky-400/10 text-slate-100" : "border-emergency-line bg-emergency-panel2 text-slate-500"}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[type] }} />
              {meta.label}
            </button>
          ))}
        </div>
        {!!riskLayers.length && (
          <div className="flex flex-wrap gap-2 text-xs text-slate-300">
            {riskLayers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => {
                  setVisibleRiskLayers((current) => current.includes(layer.id)
                    ? current.filter((item) => item !== layer.id)
                    : [...current, layer.id]);
                }}
                className={`rounded-md border px-2 py-1 transition ${visibleRiskLayers.includes(layer.id) ? "border-emergency-orange/70 bg-emergency-orange/10 text-orange-100" : "border-emergency-line bg-emergency-panel2 text-slate-500"}`}
              >
                {layer.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-[30rem] md:h-[38rem]">
        {!mounted ? (
          <div className="flex h-full items-center justify-center bg-emergency-panel text-sm text-slate-400">
            Caricamento mappa...
          </div>
        ) : (
        <MapContainer center={FLORENCE_CENTER} zoom={9} minZoom={7} maxZoom={18} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <LayersControl position="topright">
            {WMS_LAYERS.map((layer) => (
              <LayersControl.Overlay key={layer.key} name={layer.label}>
                <WMSTileLayer
                  url={layer.url}
                  layers={layer.layers}
                  format="image/png"
                  transparent
                  version="1.3.0"
                  opacity={layer.opacity}
                />
              </LayersControl.Overlay>
            ))}
          </LayersControl>

          {mapStations.map((station) => {
            const hydroMeasurement = station.measurements.find((item) => item.type === "hydrometry");
            const hydroStatus = hydroMeasurement ? getHydroStatus(hydroMeasurement) : null;
            return (
              <Marker key={station.id} position={[station.lat, station.lng]} icon={stationIcon(station)}>
                <Popup>
                  <div className="min-w-64 rounded-md bg-[#07111f] p-1 text-slate-100">
                    <p className="font-semibold text-white">{station.name}</p>
                    <p className="text-xs text-slate-300">{station.id}</p>
                    {station.approximate && (
                      <p className="mt-2 rounded-md border border-emergency-yellow/50 bg-emergency-yellow/15 px-2 py-1 text-xs text-yellow-50">
                        Posizione indicativa: aggiornare le coordinate CFR appena disponibili.
                      </p>
                    )}
                    <div className="mt-3 space-y-2">
                      {station.measurements.map((item) => {
                        const meta = MEASUREMENT_TYPES[item.type];
                        return (
                          <div
                            key={`${item.type}-${item.id}`}
                            className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.08] px-2 py-1.5 text-sm"
                          >
                            <span className="font-medium text-slate-200">{meta?.label || item.type}</span>
                            <strong className="text-white">{item.value ?? "n.d."} {item.unit}</strong>
                          </div>
                        );
                      })}
                    </div>
                    {hydroStatus && (
                      <p className="mt-3 rounded-md px-2 py-1 text-xs font-semibold" style={{ color: hydroStatus.color, background: `${hydroStatus.color}1a` }}>
                        {hydroStatus.label}
                      </p>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {mapStations.map((station) => {
            const color = stationColor(station);
            return (
              <CircleMarker
                key={`${station.id}-halo`}
                center={[station.lat, station.lng]}
                radius={station.approximate ? 10 : 16}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.06, opacity: 0.36, weight: 2 }}
              />
            );
          })}

          {riskLayers
            .filter((layer) => visibleRiskLayers.includes(layer.id))
            .map((layer) => (
              <GeoJSON
                key={layer.id}
                data={layer.geojson}
                style={{
                  color: layer.id === "landslide" ? "#fb923c" : "#38bdf8",
                  weight: 2,
                  fillOpacity: 0.22
                }}
              />
            ))}
        </MapContainer>
        )}
      </div>
    </section>
  );
}
