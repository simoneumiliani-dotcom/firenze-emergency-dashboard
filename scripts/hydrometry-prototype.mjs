#!/usr/bin/env node
const SOURCES = {
  activeHydrometers: "https://geo.sir.toscana.it/geoserver/geo/ows?maxFeatures=300000&outputFormat=application%2Fjson&request=GetFeature&service=WFS&typeName=geo%3Acf_idrometri&version=1.0.0",
  stationArchive: "https://www.sir.toscana.it/archivio/dati.php?D=json_stations",
  cfrDetail: "https://www.cfr.toscana.it/monitoraggio/dettaglio.php"
};

const province = process.argv.find((arg) => arg.startsWith("--province="))?.split("=")[1] || "FI";
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || 8);

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("HTTP " + response.status + " per " + url);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 hydrometry-prototype"
    }
  });
  if (!response.ok) throw new Error("HTTP " + response.status + " per " + url);
  return response.text();
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function clean(value) {
  return String(value || "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeDateTime(value) {
  const text = clean(value);
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})[.:](\d{2})/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0, 0).toISOString();
}

function isLonLat(coords) {
  return Array.isArray(coords) && Math.abs(Number(coords[0])) <= 180 && Math.abs(Number(coords[1])) <= 90;
}

function historicalInfo(feature) {
  const consistency = feature?.properties?.Consistenza || {};
  const entry = Object.entries(consistency).find(([label]) => /IDROMETRIA/i.test(label));
  return entry ? { label: entry[0], url: entry[1]?.SorgenteDati || null } : { label: null, url: null };
}

function normalizeStation(feature, archiveByCode) {
  const props = feature.properties || {};
  const archive = archiveByCode.get(props.id_stazione);
  const archiveProps = archive?.properties || {};
  const coords = isLonLat(archive?.geometry?.coordinates) ? archive.geometry.coordinates : null;
  const historical = historicalInfo(archive);
  return {
    station_id: props.id_stazione,
    station_code: props.id_stazione,
    station_name: clean(props.nome),
    river_name: null,
    basin: clean(props.gc || props.zona) || null,
    latitude: coords ? Number(coords[1]) : null,
    longitude: coords ? Number(coords[0]) : null,
    province: props.provincia || archiveProps.Provincia || null,
    municipality: props.comune || archiveProps.Comune || null,
    historical_url: historical.url,
    historical_label: historical.label,
    measurement_time: null,
    level_m: null,
    flow_mc_s: null,
    source_type: "opendata_station",
    source_url: SOURCES.activeHydrometers,
    validated: true
  };
}

function parseCfrRows(html) {
  const rows = [];
  const declarations = String(html || "").matchAll(/\w+\[\d+\]\s*=\s*new\s+Array\((.*?)\);/g);
  for (const declaration of declarations) {
    const items = [];
    const quoted = declaration[1].matchAll(/(["'])((?:\\.|(?!\1).)*?)\1/g);
    for (const item of quoted) items.push(clean(item[2]));
    if (items.length >= 3) rows.push(items);
  }
  return rows;
}

async function fetchRealtime(station) {
  const params = new URLSearchParams({ id: station.station_id, type: "idro", _: String(Date.now()) });
  const sourceUrl = SOURCES.cfrDetail + "?" + params.toString();
  const rows = parseCfrRows(await fetchText(sourceUrl));
  const last = rows.at(-1);
  if (!last) return null;
  const level = parseNumber(last[2]);
  if (!Number.isFinite(level)) return null;
  return {
    station_id: station.station_id,
    station_code: station.station_code,
    station_name: station.station_name,
    river_name: station.river_name,
    basin: station.basin,
    latitude: station.latitude,
    longitude: station.longitude,
    measurement_time: normalizeDateTime(last[1]),
    level_m: level,
    flow_mc_s: parseNumber(last[3]),
    source_type: "cfr_realtime",
    source_url: sourceUrl,
    validated: false
  };
}

async function main() {
  const [active, archive] = await Promise.all([fetchJson(SOURCES.activeHydrometers), fetchJson(SOURCES.stationArchive)]);
  const archiveByCode = new Map((archive.features || []).map((feature) => [feature.properties?.Codice, feature]));
  const stations = (active.features || [])
    .map((feature) => normalizeStation(feature, archiveByCode))
    .filter((station) => station.station_id && station.province === province);
  const realtime = [];
  for (const station of stations.slice(0, limit)) {
    try {
      const row = await fetchRealtime(station);
      if (row) realtime.push(row);
    } catch (error) {
      console.error("Realtime non disponibile per", station.station_id, error.message);
    }
  }
  console.log(JSON.stringify({ province, counts: { stations: stations.length, realtime: realtime.length }, stations, realtime }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
