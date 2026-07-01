import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CONFIGURED_LAYERS = [
  {
    id: "hydraulic",
    label: "Pericolosita idraulica",
    url: process.env.GEOSCOPIO_PI_GEOJSON_URL
  },
  {
    id: "landslide",
    label: "Pericolosita da frana",
    url: process.env.GEOSCOPIO_FRANE_GEOJSON_URL
  }
].filter((layer) => layer.url);

async function fetchGeoJson(layer) {
  const response = await fetch(layer.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${layer.id} HTTP ${response.status}`);
  const geojson = await response.json();
  return { id: layer.id, label: layer.label, geojson };
}

async function searchCkan() {
  const params = new URLSearchParams({
    q: "pericolosita idraulica frana Firenze geojson",
    rows: "5"
  });
  const response = await fetch(`https://dati.toscana.it/api/3/action/package_search?${params.toString()}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`CKAN HTTP ${response.status}`);
  const payload = await response.json();
  return payload.result?.results?.map((item) => ({
    title: item.title,
    name: item.name,
    resources: item.resources?.map((resource) => ({
      name: resource.name,
      format: resource.format,
      url: resource.url
    }))
  })) || [];
}

export async function GET() {
  const layers = [];
  const warnings = [];

  for (const layer of CONFIGURED_LAYERS) {
    try {
      layers.push(await fetchGeoJson(layer));
    } catch (error) {
      warnings.push(`Layer ${layer.label} non disponibile.`);
    }
  }

  let ckanHints = [];
  try {
    ckanHints = await searchCkan();
  } catch (error) {
    warnings.push("Ricerca CKAN dati.toscana.it non disponibile in questo momento.");
  }

  return NextResponse.json({
    source: "Geoscopio / Open Data Toscana CKAN",
    fetchedAt: new Date().toLocaleString("it-IT"),
    layers,
    ckanHints,
    warning: warnings.join(" ")
  });
}
