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

export const DEFAULT_PROVINCE = "FI";

export const LEVEL_NAMES = { verde: "Verde", giallo: "Giallo", arancione: "Arancione", rosso: "Rosso" };

export const LEVEL_ORDER = { Verde: 0, Giallo: 1, Arancione: 2, Rosso: 3 };

// Zone di ogni provincia, ricavate al contrario da ZONE_PROVINCES.
export const PROVINCE_ZONES = Object.keys(TOSCANA_PROVINCES).reduce((accumulator, sigla) => {
  accumulator[sigla] = ZONE_CODES.filter((zone) => ZONE_PROVINCES[zone].includes(sigla));
  return accumulator;
}, {});

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
