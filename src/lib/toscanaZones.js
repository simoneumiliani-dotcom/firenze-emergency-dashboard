// Zone di allerta CFR (delibera regionale 395 del 07/04/2015) e province toscane
// che contengono almeno un comune della zona. La mappatura è ricavata dall'elenco
// dei comuni per zona pubblicato dal CFR: serve a ricavare dal bollettino il
// livello di qualsiasi territorio, non solo di Firenze.

export const TOSCANA_PROVINCES = {
  AR: "Arezzo",
  FI: "Firenze",
  GR: "Grosseto",
  LI: "Livorno",
  LU: "Lucca",
  MS: "Massa-Carrara",
  PI: "Pisa",
  PO: "Prato",
  PT: "Pistoia",
  SI: "Siena"
};

export const ZONE_PROVINCES = {
  A1: ["AR"],
  A2: ["AR", "FI"],
  A3: ["FI"],
  A4: ["FI", "LI", "LU", "PI", "PT"],
  A5: ["FI", "PI", "SI"],
  A6: ["LI", "PI"],
  I: ["LI"],
  B: ["FI", "PO", "PT"],
  C: ["AR", "SI"],
  E1: ["GR", "LI", "PI", "SI"],
  E2: ["LI"],
  E3: ["GR", "LI"],
  F1: ["GR", "SI"],
  F2: ["GR"],
  L: ["MS"],
  M: ["FI"],
  O1: ["SI"],
  O2: ["GR", "SI"],
  O3: ["GR"],
  R1: ["PO", "PT"],
  R2: ["FI"],
  S1: ["LU", "PT"],
  S2: ["LU"],
  S3: ["LU", "PI"],
  T: ["AR"],
  V: ["LU", "MS"]
};

export const ZONE_CODES = Object.keys(ZONE_PROVINCES);

// Nomi delle zone come nella legenda "Aree interessate" del bollettino CFR.
export const ZONE_NAMES = {
  A1: "Arno-Casentino",
  A2: "Arno-Valdarno Sup.",
  A3: "Arno-Firenze",
  A4: "Valdarno Inf.",
  A5: "Valdelsa-Valdera",
  A6: "Arno-Costa",
  B: "Bisenzio e Ombr. Pt",
  C: "Valdichiana",
  E1: "Etruria",
  E2: "Etruria-Costa Nord",
  E3: "Etruria-Costa Sud",
  F1: "Fiora e Albegna",
  F2: "Fiora e Albegna-Costa",
  I: "Isole",
  L: "Lunigiana",
  M: "Mugello-Val di Sieve",
  O1: "Ombrone Gr-Alto",
  O2: "Ombrone Gr-Medio",
  O3: "Ombrone Gr-Costa",
  R1: "Reno",
  R2: "Romagna-Toscana",
  S1: "Serchio-Garfagnana-Lima",
  S2: "Serchio-Lucca",
  S3: "Serchio-Costa",
  T: "Valtiberina",
  V: "Versilia"
};

export const DEFAULT_PROVINCE = "FI";

export const LEVEL_NAMES = { verde: "Verde", giallo: "Giallo", arancione: "Arancione", rosso: "Rosso" };

export const LEVEL_ORDER = { Verde: 0, Giallo: 1, Arancione: 2, Rosso: 3 };

// Zone di ogni provincia, ricavate al contrario da ZONE_PROVINCES.
export const PROVINCE_ZONES = Object.keys(TOSCANA_PROVINCES).reduce((accumulator, sigla) => {
  accumulator[sigla] = ZONE_CODES.filter((zone) => ZONE_PROVINCES[zone].includes(sigla));
  return accumulator;
}, {});

// Rischi della tabella zona/livello del bollettino CFR: il livello di una zona
// vale per un rischio preciso (vento, idrogeologico, mareggiate...).
export const RISK_KEYS = [
  "idrogeologico",
  "idraulico",
  "temporali",
  "vento",
  "mareggiate",
  "neve",
  "ghiaccio"
];

// Aree fiorentine mostrate nella pagina Allerte e zone CFR che le contengono,
// ricavate dall'elenco dei comuni per zona (delibera regionale 395/2015 e
// aggiornamento 1526/2025). Il bollettino assegna il livello alle zone: le aree
// interessate sono quelle delle zone elencate nella tabella, non quelle
// nominate nella legenda o nel resto del testo.
export const ZONE_AREAS = {
  A2: ["valdarno"],
  A3: ["firenze", "greve", "ema", "chianti"],
  A4: ["valdarno", "empolese"],
  A5: ["empolese"],
  B: ["bisenzio"],
  M: ["mugello", "sieve"]
};

// Aree toccate da un insieme di zone, nell'ordine dichiarato sopra.
export function areasForZones(zones) {
  const wanted = new Set(Array.isArray(zones) ? zones : []);
  return [
    ...new Set(
      Object.entries(ZONE_AREAS)
        .filter(([zone]) => wanted.has(zone))
        .flatMap(([, areas]) => areas)
    )
  ];
}

export function strongestLevel(levels) {
  return (Array.isArray(levels) ? levels : []).reduce(
    (best, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[best] ? level : best),
    "Verde"
  );
}

// Livello di una provincia: il massimo tra le zone che contengono suoi comuni.
// Le zone senza riga nel bollettino valgono Verde, come nel bollettino CFR.
export function getProvinceLevels(zoneLevels) {
  const levels = {};
  Object.entries(PROVINCE_ZONES).forEach(([sigla, zones]) => {
    levels[sigla] = strongestLevel(zones.map((zone) => zoneLevels?.[zone]).filter(Boolean));
  });
  return levels;
}
