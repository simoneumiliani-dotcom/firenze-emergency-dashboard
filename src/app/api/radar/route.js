import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DPC_API_BASE = "https://radar-api.protezionecivile.it";
const DPC_WMS_BASE = "https://radar-geowebcache.protezionecivile.it/service/wms";
const WMS_CAPABILITIES_URL = `${DPC_WMS_BASE}?SERVICE=WMS&VERSION=1.1.1&REQUEST=getcapabilities&TILED=true`;
const DPC_WEB_ORIGIN = "https://radar.protezionecivile.it";

const PRODUCTS = [
  {
    id: "VMI",
    apiType: "VMI",
    label: "Massima intensita verticale",
    shortLabel: "VMI",
    description: "Prodotto radar VMI usato per leggere nuclei convettivi e precipitazioni intense.",
    cadence: "5 min",
    unit: "dBZ",
    wmsLayer: "radar:vmi",
    mapEnabled: true
  },
  {
    id: "SRI",
    apiType: "SRI",
    label: "Intensita pioggia",
    shortLabel: "SRI",
    description: "Stima radar della intensita di precipitazione al suolo.",
    cadence: "5 min",
    unit: "mm/h",
    wmsLayer: "radar:sri",
    mapEnabled: true
  },
  {
    id: "SRT1",
    apiType: "SRT1",
    label: "Pioggia cumulata 1h",
    shortLabel: "SRT 1h",
    description: "Stima radar della pioggia cumulata nell'ultima ora.",
    cadence: "5 min",
    unit: "mm",
    wmsLayer: "radar:srt_1",
    mapEnabled: true
  },
  {
    id: "CUM3",
    apiType: "CUM3",
    label: "Pioggia cumulata 3h",
    shortLabel: "CUM 3h",
    description: "Cumulata da rete a terra interpolata su tre ore.",
    cadence: "60 min",
    unit: "mm",
    wmsLayer: "radar:cum3",
    mapEnabled: true
  },
  {
    id: "CUM6",
    apiType: "CUM6",
    label: "Pioggia cumulata 6h",
    shortLabel: "CUM 6h",
    description: "Cumulata da rete a terra interpolata su sei ore.",
    cadence: "60 min",
    unit: "mm",
    wmsLayer: "radar:cum6",
    mapEnabled: true
  },
  {
    id: "CUM12",
    apiType: "CUM12",
    label: "Pioggia cumulata 12h",
    shortLabel: "CUM 12h",
    description: "Cumulata da rete a terra interpolata su dodici ore.",
    cadence: "60 min",
    unit: "mm",
    wmsLayer: "radar:cum12",
    mapEnabled: true
  },
  {
    id: "CUM24",
    apiType: "CUM24",
    label: "Pioggia cumulata 24h",
    shortLabel: "CUM 24h",
    description: "Cumulata da rete a terra interpolata su ventiquattro ore.",
    cadence: "60 min",
    unit: "mm",
    wmsLayer: "radar:cum24",
    mapEnabled: true
  },
  {
    id: "IR_108",
    apiType: "IR_108",
    label: "Copertura nuvolosa",
    shortLabel: "IR 10.8",
    description: "Prodotto satellitare derivato dal canale infrarosso 10.8.",
    cadence: "5 min",
    unit: "K",
    wmsLayer: "radar:ir_108",
    mapEnabled: true
  },
  {
    id: "TEMP",
    apiType: "TEMP",
    label: "Temperature",
    shortLabel: "TMP",
    description: "Mappa temperature ottenuta da rete termometrica a terra.",
    cadence: "60 min",
    unit: "C",
    wmsLayer: "radar:tmp",
    mapEnabled: true
  },
  {
    id: "POH",
    apiType: "POH",
    label: "Probabilita grandine",
    shortLabel: "POH",
    description: "Probabilita radar di grandine.",
    cadence: "5 min",
    unit: "%",
    wmsLayer: "radar:poh",
    mapEnabled: true
  },
  {
    id: "VIL",
    apiType: "VIL",
    label: "Acqua integrata verticale",
    shortLabel: "VIL",
    description: "Prodotto radar utile per stimare il contenuto d'acqua verticale dei sistemi temporaleschi.",
    cadence: "5 min",
    unit: "kg/m2",
    wmsLayer: "radar:vil",
    mapEnabled: true
  },
  {
    id: "ETM",
    apiType: "ETM",
    label: "Echo top",
    shortLabel: "ETM",
    description: "Altezza massima delle precipitazioni rilevate dal radar.",
    cadence: "5 min",
    unit: "m",
    wmsLayer: "radar:etm",
    mapEnabled: true
  },
  {
    id: "SITES",
    apiType: "SITES",
    label: "Siti radar",
    shortLabel: "SITES",
    description: "Ubicazione e stato operativo dei siti radar.",
    cadence: "5 min",
    unit: "stato",
    wmsLayer: "radar:sites",
    mapEnabled: true
  }
];

function normalizeDateFromEpoch(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const date = new Date(number);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      ...options,
      headers: {
        accept: "application/json,text/plain,*/*",
        origin: DPC_WEB_ORIGIN,
        referer: `${DPC_WEB_ORIGIN}/`,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      const detail = payload?.message || payload?.error || payload?.raw || "";
      throw new Error(("HTTP " + response.status + " " + detail).trim());
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeLastProduct(product, payload) {
  const item = Array.isArray(payload?.lastProducts) ? payload.lastProducts[0] : null;
  if (!item) return null;
  const date = normalizeDateFromEpoch(item.time);

  return {
    id: null,
    product: item.productType || product.apiType,
    date,
    wmsTime: date,
    productDate: Number.isFinite(Number(item.time)) ? Number(item.time) : null,
    period: item.period || null,
    quality: null,
    createdAt: null,
    updatedAt: null,
    dataCount: null,
    sourceType: "findLastProductByType"
  };
}

function serializeProduct(product) {
  return {
    ...product,
    restLastUrl: `${DPC_API_BASE}/findLastProductByType?type=${encodeURIComponent(product.apiType)}`,
    downloadUrl: `${DPC_API_BASE}/downloadProduct`,
    wmsBaseUrl: DPC_WMS_BASE,
    wmsCapabilitiesUrl: WMS_CAPABILITIES_URL
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedProduct = String(searchParams.get("product") || "VMI").toUpperCase();
  const product = PRODUCTS.find((item) => item.id === requestedProduct || item.apiType === requestedProduct) || PRODUCTS[0];
  const errors = [];
  let lastProduct = null;
  let rawDownload = null;

  try {
    const payload = await fetchJson(`${DPC_API_BASE}/findLastProductByType?type=${encodeURIComponent(product.apiType)}`);
    lastProduct = normalizeLastProduct(product, payload);
  } catch (error) {
    errors.push({
      source: "DPC findLastProductByType",
      message: error.message
    });
  }

  if (lastProduct?.productDate) {
    try {
      rawDownload = await fetchJson(`${DPC_API_BASE}/downloadProduct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productType: product.apiType,
          productDate: lastProduct.productDate
        })
      });
    } catch (error) {
      errors.push({
        source: "DPC downloadProduct",
        message: error.message
      });
    }
  }

  return NextResponse.json(
    {
      source: "DPC Radar Protezione Civile",
      fetchedAt: new Date().toISOString(),
      product: serializeProduct(product),
      products: PRODUCTS.map(serializeProduct),
      lastProduct,
      rawDownload,
      services: {
        rest: DPC_API_BASE,
        wms: DPC_WMS_BASE,
        wmsCapabilities: WMS_CAPABILITIES_URL
      },
      errors
    },
    {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" }
    }
  );
}
