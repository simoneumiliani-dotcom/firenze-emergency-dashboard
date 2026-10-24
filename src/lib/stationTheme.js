// Palette unica per i sei tipi di misura: la usano la mappa, le legende e il
// catalogo stazioni, cosi' lo stesso sensore ha sempre lo stesso colore.
export const SENSOR_COLORS = {
  pluviometry: "#38bdf8",
  hydrometry: "#22c55e",
  thermometry: "#fb923c",
  anemometry: "#a78bfa",
  hygrometry: "#14b8a6",
  nivometry: "#facc15"
};

export const FALLBACK_SENSOR_COLOR = "#94a3b8";

export function sensorColor(type) {
  return SENSOR_COLORS[type] || FALLBACK_SENSOR_COLOR;
}

// Stile per i badge del catalogo: stesso colore del sensore, con bordo e
// sfondo semitrasparenti ottenuti dall'esadecimale.
export function sensorBadgeStyle(type) {
  const color = sensorColor(type);
  return {
    color,
    borderColor: color + "80",
    backgroundColor: color + "1f"
  };
}
