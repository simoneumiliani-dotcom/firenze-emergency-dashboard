// Palette ufficiali Radar-DPC.
//
// Le tile WebP del tile cache DPC NON sono immagini colorate: sono raster di
// valori, con l'intensita codificata nel solo canale rosso (G e B sempre a 0,
// alpha sempre 255). L'applicazione ufficiale decodifica il valore con
//   valore = srcMin + (R / 255) * (srcMax - srcMin)
// e lo colora con una palette per prodotto. Questi parametri riproducono quella
// logica lato client, cosi la mappa mostra gli stessi colori della legenda.

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, factor) => a + (b - a) * factor;

function smooth(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mixColor(from, to, factor) {
  return [mix(from[0], to[0], factor), mix(from[1], to[1], factor), mix(from[2], to[2], factor)];
}

function ramp(t, stops, colors, alphas) {
  const last = colors.length - 1;
  if (t <= stops[0]) return [...colors[0], alphas[0]];
  for (let index = 1; index <= last; index += 1) {
    if (t <= stops[index]) {
      const span = stops[index] - stops[index - 1];
      const factor = smooth(0, 1, clamp01(span > 0 ? (t - stops[index - 1]) / span : 1));
      const color = mixColor(colors[index - 1], colors[index], factor);
      return [...color, mix(alphas[index - 1], alphas[index], factor)];
    }
  }
  return [...colors[last], alphas[last]];
}

// VMI - riflettivita massima (dBZ), 0..60
const VMI_STOPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 1];
const VMI_COLORS = [
  [135, 135, 135],
  [135, 135, 135],
  [0, 250, 250],
  [0, 250, 250],
  [0, 250, 0],
  [250, 250, 0],
  [250, 100, 0],
  [250, 0, 0]
];
const VMI_ALPHAS = [0.1, 0, 0, 0.4, 0.8, 0.8, 0.8, 0.8];

function vmiColor(value) {
  return ramp(clamp01(value / 100), VMI_STOPS, VMI_COLORS, VMI_ALPHAS);
}

// SRI - intensita di pioggia (mm/h), 0..100
function sriColor(value) {
  const t = clamp01(value / 100);
  const c0 = [191, 230, 128];
  const c1 = [0, 204, 255];
  const c2 = [0, 204, 0];
  const c3 = [255, 255, 0];
  const c4 = [255, 166, 77];
  const c5 = [255, 0, 77];
  const c6 = [153, 0, 204];
  const a = mixColor(c0, c1, smooth(0, 0.08, t));
  const b = mixColor(c2, c3, smooth(0.12, 0.3, t));
  const d = mixColor(c4, c5, smooth(0.4, 0.7, t));
  const e = mixColor(d, c6, smooth(0.7, 1, t));
  const color = mixColor(mixColor(a, b, t >= 0.2 ? 1 : 0), e, smooth(0.35, 1, t));
  return [...color, smooth(0.01, 0.05, t)];
}

// SRT/CUM - cumulate di pioggia (mm), 0..200
const CUM_STOPS = [0, 0.1 / 100.1, 10.1 / 100.1, 20.1 / 100.1, 40.1 / 100.1, 60.1 / 100.1, 1];
const CUM_COLORS = [
  [255, 255, 255],
  [0, 250, 250],
  [0, 250, 0],
  [250, 250, 0],
  [250, 100, 0],
  [250, 0, 0],
  [250, 0, 240]
];
const CUM_ALPHAS = [0, 0.4, 0.7, 0.7, 0.9, 0.9, 0.9];

function cumColor(value) {
  return ramp(clamp01(value / 100.1), CUM_STOPS, CUM_COLORS, CUM_ALPHAS);
}

// TEMP - temperatura (°C), -16..44
const TEMP_STOPS_C = [-16, -14, -10, -4, -2, 0, 2, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44];
const TEMP_COLORS = [
  [0, 26, 140],
  [0, 46, 158],
  [0, 85, 255],
  [0, 181, 255],
  [121, 225, 255],
  [0, 255, 0],
  [102, 255, 0],
  [153, 255, 0],
  [204, 255, 0],
  [255, 255, 102],
  [255, 234, 128],
  [255, 195, 77],
  [255, 158, 26],
  [255, 111, 0],
  [255, 54, 0],
  [224, 0, 0],
  [255, 0, 255],
  [178, 102, 255]
];

function tempColor(value) {
  const t = clamp01((value + 16) / 60);
  const stops = TEMP_STOPS_C.map((stop) => clamp01((stop + 16) / 60));
  const alphas = TEMP_COLORS.map(() => 0.95);
  return ramp(t, stops, TEMP_COLORS, alphas);
}

// IR 10.8 - temperatura di brillanza (°C), -70..35
const IR_STOPS_C = [-70, -60, -50, -40, -30, -20, -10, 0, 5, 10, 20, 35];
const IR_GRAYS = [255, 251, 249, 246, 244, 241, 238, 236, 232, 228, 222, 214];

function irAlpha(t) {
  const norm = (celsius) => clamp01((celsius + 70) / 105);
  if (t >= norm(20)) return 0;
  if (t >= norm(10)) return smooth(norm(20), norm(10), t) * 0.35;
  if (t >= norm(0)) return mix(0.35, 0.6, smooth(norm(10), norm(0), t));
  if (t >= norm(-20)) return mix(0.6, 0.85, smooth(norm(0), norm(-20), t));
  if (t >= norm(-40)) return mix(0.85, 0.95, smooth(norm(-20), norm(-40), t));
  if (t >= norm(-60)) return mix(0.95, 0.98, smooth(norm(-40), norm(-60), t));
  return 0.98;
}

function irColor(value) {
  const t = clamp01((value + 70) / 105);
  const stops = IR_STOPS_C.map((stop) => clamp01((stop + 70) / 105));
  const gray = ramp(t, stops, IR_GRAYS.map((g) => [g, g, g]), IR_GRAYS.map(() => 1))[0] / 255;
  // tone curve del colorizer ufficiale: rende le nubi fredde piu contrastate
  const toned = Math.round(Math.pow(clamp01(gray), 0.85) * 255);
  return [toned, toned, toned, irAlpha(t) * 0.95];
}

const PALETTES = {
  VMI: { min: 0, max: 60, color: vmiColor },
  SRI: { min: 0, max: 100, color: sriColor },
  SRT1: { min: 0, max: 200, color: cumColor },
  CUM3: { min: 0, max: 200, color: cumColor },
  CUM6: { min: 0, max: 200, color: cumColor },
  CUM12: { min: 0, max: 200, color: cumColor },
  CUM24: { min: 0, max: 200, color: cumColor },
  TEMP: { min: -16, max: 44, color: tempColor },
  IR_108: { min: -70, max: 35, color: irColor }
};

export function paletteForProduct(productId) {
  return PALETTES[productId] || PALETTES.VMI;
}

export function colorizeFromRedChannel(red, productId) {
  const palette = paletteForProduct(productId);
  const value = palette.min + (red / 255) * (palette.max - palette.min);
  return palette.color(value);
}

// Riscrive in place i pixel della tile: il canale R diventa il valore fisico.
export function colorizeTileImage(ctx, productId) {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    if (red === 0) {
      data[index + 3] = 0;
      continue;
    }
    const [r, g, b, alpha] = colorizeFromRedChannel(red, productId);
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = Math.round(clamp01(alpha) * 255);
  }
  ctx.putImageData(image, 0, 0);
}
