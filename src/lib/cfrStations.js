import meteoHubStationCatalog from "@/data/_MeteoHub.json";

const HYDRO_PLUVIO_RAW = `
TOS01000891|Il Palagio
TOS01000901|Vallombrosa
TOS01000911|Cavallina
TOS01000916|Monte di Fo
TOS01000921|Mangona
TOS01000926|Le Croci (Barberino)
TOS01000931|Ponte a Olmo
TOS01000941|Vaglia
TOS01000961|S. Agata di Mugello
TOS01000979|Razzuolo
TOS01000991|Ronta
TOS01000999|Borgo S. Lorenzo
TOS01001011|Villore
TOS01001029|Dicomano
TOS01001041|Consuma
TOS01001059|S. Brigida all'Opaco
TOS01001096|Firenze Universita
TOS01001102|Cercina
TOS01001103|Caldine
TOS01001129|Ferrone
TOS01001189|Le Croci di Calenzano
TOS01001215|S. Giusto
TOS01001225|Case Passerini
TOS01001371|Vinci
TOS01001445|Poggio Aglione
TOS01004591|Incisa Valle
TOS01004621|S. Piero a Sieve-Sieve
TOS01004659|Nave di Rosano
TOS01004725|Strada in Chianti
TOS01004784|Calenzano
TOS01004811|Ponte a Signa
TOS01004915|Montespertoli
TOS01004921|Turbone
TOS01004941|Empoli
TOS01004967|Certaldo
TOS01004971|Castelfiorentino
TOS03001001|Monte Giovi
TOS03001097|Firenze Orto Botanico
TOS03001099|Firenze Giardino di Boboli
TOS03001135|Poggio alla Croce
TOS03001137|S. Donato in Collina
TOS03001145|Vingone
TOS11000017|Borgo S. Lorenzo 2
TOS11000021|Tavarnelle
TOS11000022|Barberino
TOS11000023|Lamole
TOS11000024|Remole
TOS11000057|Sambuca
TOS11000071|Cerreto Guidi
TOS11000073|Greve in Chianti
TOS11000089|Pelago
TOS11000108|Giogo
TOS11000504|Monteboro
TOS11000505|Casa Sartori
TOS30248000|Bibbiana
TOS30248400|Casaglia
TOS30250000|Marradi
TOS30287500|Barco
TOS30287700|Monte Faggiola
TOS30290200|Piancaldoli
TOS30290300|Firenzuola
TOS30290400|Palazzuolo sul Senio
`;

const THERMO_RAW = `
TOS01000901|Vallombrosa
TOS01000916|Monte di Fo
TOS01000921|Mangona
TOS01000926|Le Croci (Barberino)
TOS01000999|Borgo S. Lorenzo
TOS01001011|Villore
TOS01001041|Consuma
TOS01001059|S. Brigida all'Opaco
TOS01001096|Firenze Universita
TOS01001215|S. Giusto
TOS01001225|Case Passerini
TOS01001445|Poggio Aglione
TOS01004915|Montespertoli
TOS01004941|Empoli
TOS01004967|Certaldo
TOS01004971|Castelfiorentino
TOS03001001|Monte Giovi
TOS03001097|Firenze Orto Botanico
TOS03001099|Firenze Giardino di Boboli
TOS03001135|Poggio alla Croce
TOS03001137|S. Donato in Collina
TOS11000017|Borgo S. Lorenzo 2
TOS11000021|Tavarnelle
TOS11000022|Barberino
TOS11000023|Lamole
TOS11000024|Remole
TOS11000057|Sambuca
TOS11000071|Cerreto Guidi
TOS11000073|Greve in Chianti
TOS11000089|Pelago
TOS11000108|Giogo
TOS11000504|Monteboro
TOS11000505|Casa Sartori
TOS30248000|Bibbiana
TOS30287500|Barco
TOS30290300|Firenzuola
`;

const WIND_HUMIDITY_RAW = `
TOS01000891|Il Palagio
TOS01000901|Vallombrosa
TOS01000911|Cavallina
TOS01000916|Monte di Fo
TOS01000921|Mangona
TOS01000926|Le Croci (Barberino)
TOS01000931|Ponte a Olmo
TOS01000941|Vaglia
TOS01000961|S. Agata di Mugello
TOS01000979|Razzuolo
TOS01000991|Ronta
TOS01000999|Borgo S. Lorenzo
TOS01001011|Villore
TOS01001029|Dicomano
TOS01001041|Consuma
TOS01001059|S. Brigida all'Opaco
TOS01001096|Firenze Universita
TOS01001102|Cercina
TOS01001103|Caldine
TOS01001129|Ferrone
TOS01001189|Le Croci di Calenzano
TOS01001215|S. Giusto
TOS01001225|Case Passerini
TOS01001371|Vinci
TOS01001445|Poggio Aglione
TOS01004591|Incisa Valle
TOS01004611|Bilancino
TOS01004621|S. Piero a Sieve-Sieve
TOS01004623|S. Piero a Sieve-Carza
TOS01004641|Fornacina
TOS01004642|Fornacina 2 ul
TOS01004659|Nave di Rosano
TOS01004661|Nave di Rosano valle
TOS01004679|Firenze Uffizi
TOS01004683|Firenze Uffizi 3
TOS01004702|Ponte alle Mosse
TOS01004705|Greve
TOS01004723|Tavarnuzze
TOS01004725|Strada in Chianti
TOS01004731|Ponte di Scandicci
TOS01004784|Calenzano
TOS01004791|S. Piero a Ponti
TOS01004795|Sesto Fiorentino
TOS01004811|Ponte a Signa
TOS01004901|Montelupo
TOS01004915|Montespertoli
TOS01004921|Turbone
TOS01004941|Empoli
TOS01004967|Certaldo
TOS01004971|Castelfiorentino
TOS01005001|Fucecchio valle
TOS03001001|Monte Giovi
TOS03001097|Firenze Orto Botanico
TOS03001099|Firenze Giardino di Boboli
TOS03001135|Poggio alla Croce
TOS03001137|S. Donato in Collina
TOS03001145|Vingone
TOS03004373|Firenzuola Coniale
TOS03004729|Ponte a Niccheri
TOS03004911|Sambuca
TOS03004935|Empoli-Pontorme
TOS11000017|Borgo S. Lorenzo 2
TOS11000021|Tavarnelle
TOS11000022|Barberino
TOS11000023|Lamole
TOS11000024|Remole
TOS11000057|Sambuca
TOS11000071|Cerreto Guidi
TOS11000073|Greve in Chianti
TOS11000089|Pelago
TOS11000108|Giogo
TOS11000504|Monteboro
TOS11000505|Casa Sartori
TOS15004682|Firenze Uffizi 2
TOS19000704|Grassina
TOS30248000|Bibbiana
TOS30248400|Casaglia
TOS30250000|Marradi
TOS30287500|Barco
TOS30287700|Monte Faggiola
TOS30290200|Piancaldoli
TOS30290300|Firenzuola
TOS30290400|Palazzuolo sul Senio
`;

const NIVOMETRY_EXTRA_RAW = `
TOS01000025|Vara
TOS01000056|Pian della Fioba
TOS01000544|Pisa (Fac. Agraria)
TOS01000571|Vallucciole
TOS01000581|Stia
TOS01000591|Montemignaio
TOS01000601|Ortignano
TOS01000611|Camaldoli
TOS01000621|Badia Prataglia
TOS01000626|Bibbiena
TOS01000639|La Verna
TOS01000651|Salutio
TOS01000701|Capezzine
TOS01000721|Bettolle
TOS01000741|Monte S. Savino
TOS01000751|Cortona
TOS01000761|Castiglion Fiorentino
TOS01000772|Arezzo - Fattoria S. Fabiano
TOS01000811|Badia Agnano
TOS01000831|Nusenna in Chianti
TOS01000861|Villa dell'Olio
TOS01000881|Pian di Sco
TOS01001151|Cantagallo
TOS01001161|Gavigno
TOS01001171|Vernio
TOS01001205|Prato Universita
TOS01001253|Montagnana
TOS01001263|Baggio
TOS01001269|La Ferruccia
TOS01001273|Fattoria Iavello
TOS01001284|Radda in Chianti
TOS01001379|Simignano
TOS01001419|S. Gimignano
TOS01001491|S. Miniato (Cimitero)
TOS01001561|Serra Pistoiese
TOS01001601|Montecatini Terme
TOS01001629|Castelmartini
TOS01001634|S. Baronto
TOS01001679|La Madonnina
TOS01001711|Orciatico
TOS01001781|Casciana Terme
TOS01001831|Coltano
TOS01001889|Orentano
TOS01001961|Valle Benedetta
TOS01002011|Miemo
TOS01002071|Gerfalco
TOS01002085|Anqua
TOS01002115|Ponsano
TOS01002131|Montecatini V. Cecina
TOS01002161|Libbiano
TOS01002171|Canneto
TOS01002181|Sassa
TOS01002231|Riparbella
TOS01002351|Lago
TOS01002371|Monterotondo
TOS01002381|Sassetta
TOS01002661|Siena Poggio al Vento
TOS01002779|Campiano
TOS01004005|Carrara
TOS01004007|Avenza
TOS01004379|Stia
TOS01004411|Subbiano
TOS01004521|Ponte Ferrovia FI-Roma
TOS01004557|Laterina
TOS01004561|Ponte Romito
TOS01004568|Bucine
TOS01004571|Montevarchi
TOS01004779|Gamberame
TOS01004782|Prato
TOS01004839|Pontelungo valle
TOS01004875|Poggio a Caiano
TOS01004965|Poggibonsi
TOS01004981|Ponte a Elsa
TOS01005005|Fornacino
TOS01005101|Cateratte monte
TOS01005115|Molino d'Era
TOS01005131|Capannoli
TOS01005135|Forcoli
TOS01005151|Ponsacco
TOS01005161|Belvedere
TOS01005181|Pontedera
TOS01005191|S. Giovanni alla Vena valle
TOS01005231|Pisa a Sostegno
TOS01005251|Bocca d'Arno
TOS01005262|Gello
TOS01005342|Stagno
TOS01005365|Castellina Marittima
TOS01005372|Masso degli Specchi
TOS01005377|S. Dalmazio
TOS01005386|Ponte SR439
TOS01005395|Montegemoli
TOS01005401|Ponte di Monterufoli
TOS01005403|Case Grisella
TOS01005441|Portoferraio
TOS01005461|SP Lodano
TOS01005465|Molino del Balzone
TOS01005471|Ponte per Montioni
TOS01005472|Ponte per Montioni 2
TOS01005485|Calzalunga
TOS01005489|Vecchia SS Aurelia
TOS01005572|La Cura SP152
TOS01005573|Cura Nuova
TOS01005601|Macchiascandona
TOS01005672|Buonconvento
TOS01005761|Monte Amiata Scalo
TOS01005785|Roccastrada
TOS01005791|Sasso d'Ombrone
TOS01005801|Montieri
TOS01005822|Istia
TOS01005981|Livorno Mareografo
TOS02000155|Passo Pradarena
TOS02000221|Casone di Profecchia
TOS02000351|Boscolungo
TOS02000372|Croce Arcana
TOS02000431|S. Marcello Pistoiese
TOS03000278|Renaio
TOS03000335|Foce a Giovo
TOS03000757|Monte Ginezzo
TOS03000775|Alpe di Poti
TOS03001241|Sammomme
TOS03004373|Firenzuola Coniale
TOS09001053|Passo della Cisa
TOS09001160|Passo del Cerreto
TOS11000106|Passo Radici
TOS30209600|Lago Paduli
TOS30355400|Passo Radici
`;

export const MEASUREMENT_TYPES = {
  pluviometry: { label: "Pluviometria", unit: "mm", valueLabel: "Pioggia", icon: "rain" },
  hydrometry: { label: "Idrometria", unit: "m", valueLabel: "Livello", icon: "water" },
  thermometry: { label: "Termometria", unit: "C", valueLabel: "Temperatura", icon: "temperature" },
  anemometry: { label: "Anemometria", unit: "km/h", valueLabel: "Vento", icon: "wind" },
  hygrometry: { label: "Igrometria", unit: "%", valueLabel: "Umidita", icon: "humidity" },
  nivometry: { label: "Nivometria", unit: "cm", valueLabel: "Neve", icon: "snow" }
};

function parseStations(raw, type) {
  return raw
    .trim()
    .split(/\n+/)
    .map((line) => {
      const [id, name] = line.split("|");
      return { id: id.trim(), name: name.trim(), type };
    });
}

function uniqueById(stations) {
  const map = new Map();
  stations.forEach((station) => {
    if (!map.has(station.id)) map.set(station.id, station);
  });
  return [...map.values()];
}

function stationsFromCatalog(type) {
  return meteoHubStationCatalog.stations
    .filter((station) => station.sensors.includes(type))
    .map((station) => ({ id: station.id, name: station.name, type }));
}

const LEGACY_STATIONS_BY_TYPE = {
  pluviometry: parseStations(HYDRO_PLUVIO_RAW, "pluviometry"),
  hydrometry: parseStations(HYDRO_PLUVIO_RAW, "hydrometry"),
  thermometry: parseStations(THERMO_RAW, "thermometry"),
  anemometry: parseStations(WIND_HUMIDITY_RAW, "anemometry"),
  hygrometry: parseStations(WIND_HUMIDITY_RAW, "hygrometry"),
  nivometry: uniqueById([
    ...parseStations(HYDRO_PLUVIO_RAW, "nivometry"),
    ...parseStations(WIND_HUMIDITY_RAW, "nivometry"),
    ...parseStations(NIVOMETRY_EXTRA_RAW, "nivometry")
  ])
};

export const STATIONS_BY_TYPE = Object.fromEntries(Object.keys(MEASUREMENT_TYPES).map((type) => {
  const catalogStations = stationsFromCatalog(type);
  return [type, catalogStations.length ? catalogStations : LEGACY_STATIONS_BY_TYPE[type]];
}));

export const ALL_STATIONS = uniqueById(Object.values(STATIONS_BY_TYPE).flat());

export const DEFAULT_PANEL_CONFIGS = [
  { id: "panel-1", type: "pluviometry", stationIds: ["TOS01001096", "TOS01000999", "TOS01004941"] },
  { id: "panel-2", type: "hydrometry", stationIds: ["TOS01004621", "TOS01004659", "TOS01004811"] },
  { id: "panel-3", type: "thermometry", stationIds: ["TOS01001096", "TOS01001041", "TOS11000108"] },
  { id: "panel-4", type: "anemometry", stationIds: ["TOS01000901", "TOS01001041", "TOS11000108"] }
];

export const DEFAULT_CHART_STATION_IDS = ["TOS01004621", "TOS01004659", "TOS01004811"];

export const CHART_COLORS = ["#38bdf8", "#22c55e", "#facc15", "#fb923c", "#ef4444", "#a78bfa", "#14b8a6", "#f472b6"];

export const STATION_COORDINATES = {
  TOS01000891: { lat: 43.762, lng: 11.381 },
  TOS01000901: { lat: 43.732, lng: 11.556 },
  TOS01000911: { lat: 43.979, lng: 11.263 },
  TOS01000916: { lat: 44.006, lng: 11.286 },
  TOS01000921: { lat: 44.044, lng: 11.217 },
  TOS01000926: { lat: 44.004, lng: 11.226 },
  TOS01000931: { lat: 43.884, lng: 11.329 },
  TOS01000941: { lat: 43.913, lng: 11.280 },
  TOS01000961: { lat: 43.998, lng: 11.355 },
  TOS01000979: { lat: 44.088, lng: 11.455 },
  TOS01000991: { lat: 44.003, lng: 11.431 },
  TOS01000999: { lat: 43.955, lng: 11.386 },
  TOS01001011: { lat: 43.929, lng: 11.548 },
  TOS01001029: { lat: 43.893, lng: 11.526 },
  TOS01001041: { lat: 43.785, lng: 11.585 },
  TOS01001059: { lat: 43.842, lng: 11.415 },
  TOS01001096: { lat: 43.777, lng: 11.258 },
  TOS01001102: { lat: 43.843, lng: 11.244 },
  TOS01001103: { lat: 43.819, lng: 11.302 },
  TOS01001129: { lat: 43.600, lng: 11.308 },
  TOS01001189: { lat: 43.891, lng: 11.173 },
  TOS01001215: { lat: 43.759, lng: 11.171 },
  TOS01001225: { lat: 43.812, lng: 11.165 },
  TOS01001371: { lat: 43.783, lng: 10.923 },
  TOS01001445: { lat: 43.692, lng: 10.867 },
  TOS01004591: { lat: 43.654, lng: 11.449 },
  TOS01004611: { lat: 44.000, lng: 11.275 },
  TOS01004621: { lat: 43.963, lng: 11.323 },
  TOS01004623: { lat: 43.963, lng: 11.323 },
  TOS01004641: { lat: 43.918, lng: 11.319 },
  TOS01004642: { lat: 43.918, lng: 11.319 },
  TOS01004659: { lat: 43.770, lng: 11.426 },
  TOS01004661: { lat: 43.770, lng: 11.426 },
  TOS01004679: { lat: 43.768, lng: 11.256 },
  TOS01004683: { lat: 43.768, lng: 11.256 },
  TOS01004702: { lat: 43.781, lng: 11.230 },
  TOS01004705: { lat: 43.587, lng: 11.317 },
  TOS01004723: { lat: 43.710, lng: 11.228 },
  TOS01004725: { lat: 43.656, lng: 11.295 },
  TOS01004731: { lat: 43.758, lng: 11.184 },
  TOS01004784: { lat: 43.854, lng: 11.166 },
  TOS01004791: { lat: 43.819, lng: 11.111 },
  TOS01004795: { lat: 43.833, lng: 11.199 },
  TOS01004811: { lat: 43.784, lng: 11.095 },
  TOS01004901: { lat: 43.729, lng: 11.018 },
  TOS01004915: { lat: 43.644, lng: 11.073 },
  TOS01004921: { lat: 43.674, lng: 11.010 },
  TOS01004941: { lat: 43.718, lng: 10.947 },
  TOS01004967: { lat: 43.548, lng: 11.041 },
  TOS01004971: { lat: 43.609, lng: 10.969 },
  TOS01005001: { lat: 43.731, lng: 10.811 },
  TOS03001001: { lat: 43.857, lng: 11.456 },
  TOS03001097: { lat: 43.777, lng: 11.262 },
  TOS03001099: { lat: 43.763, lng: 11.249 },
  TOS03001135: { lat: 43.634, lng: 11.452 },
  TOS03001137: { lat: 43.728, lng: 11.386 },
  TOS03001145: { lat: 43.775, lng: 11.177 },
  TOS03004373: { lat: 44.119, lng: 11.379 },
  TOS03004729: { lat: 43.729, lng: 11.314 },
  TOS03004911: { lat: 43.568, lng: 11.210 },
  TOS03004935: { lat: 43.720, lng: 10.959 },
  TOS11000017: { lat: 43.955, lng: 11.386 },
  TOS11000021: { lat: 43.562, lng: 11.172 },
  TOS11000022: { lat: 44.000, lng: 11.238 },
  TOS11000023: { lat: 43.514, lng: 11.376 },
  TOS11000024: { lat: 43.770, lng: 11.426 },
  TOS11000057: { lat: 43.568, lng: 11.210 },
  TOS11000071: { lat: 43.758, lng: 10.878 },
  TOS11000073: { lat: 43.587, lng: 11.317 },
  TOS11000089: { lat: 43.772, lng: 11.503 },
  TOS11000108: { lat: 44.006, lng: 11.490 },
  TOS11000504: { lat: 43.717, lng: 10.971 },
  TOS11000505: { lat: 43.676, lng: 10.902 },
  TOS15004682: { lat: 43.768, lng: 11.256 },
  TOS19000704: { lat: 43.734, lng: 11.302 },
  TOS30248000: { lat: 44.064, lng: 11.638 },
  TOS30248400: { lat: 44.071, lng: 11.565 },
  TOS30250000: { lat: 44.073, lng: 11.613 },
  TOS30287500: { lat: 44.134, lng: 11.400 },
  TOS30287700: { lat: 44.126, lng: 11.480 },
  TOS30290200: { lat: 44.199, lng: 11.339 },
  TOS30290300: { lat: 44.120, lng: 11.379 },
  TOS30290400: { lat: 44.113, lng: 11.548 }
};

const CATALOG_COORDINATES = Object.fromEntries(
  meteoHubStationCatalog.stations.map((station) => [station.id, { lat: station.lat, lng: station.lng }])
);

export function getStationCatalog(type) {
  return STATIONS_BY_TYPE[type] || [];
}

export function getMeasurementMeta(type) {
  return MEASUREMENT_TYPES[type] || MEASUREMENT_TYPES.pluviometry;
}

export function getStationById(id) {
  return ALL_STATIONS.find((station) => station.id === id) || null;
}

export function getStationPosition(id) {
  const position = CATALOG_COORDINATES[id] || STATION_COORDINATES[id];
  return position ? { ...position, approximate: false } : {};
}
