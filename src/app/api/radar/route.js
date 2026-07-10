import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DPC_API_BASE = "https://radar-api.protezionecivile.it";
const DPC_REST_BASE = `${DPC_API_BASE}/api/v1/radar/dpc`;
const DPC_WMS_BASE = `${DPC_API_BASE}/wide/product`;
const WMS_CAPABILITIES_URL = `${DPC_WMS_BASE}?service=WMS&request=GetCapabilities`;

const PRODUCTS = [
  {
    id: "SRI",
    dataType: "it",
    label: "Intensita pioggia",
    shortLabel: "SRI",
    description: "Stima radar dell'intensita di precipitazione al suolo.",
    cadence: "5 min",
    unit: "mm/h",
    wmsLayer: "rv:SRI:it:SRI_VMI",
    mapEnabled: true
  },
  {
    id: "SRT",
    dataType: "it",
    label: "Pioggia cumulata",
    shortLabel: "SRT",
    description: "Stima radar della precipitazione cumulata.",
    cadence: "15 min",
    unit: "mm",
    wmsLayer: null,
    mapEnabled: false
  },
  {
    id: "HRD",
    dataType: "it",
    label: "Grandine rilevata",
    shortLabel: "HRD",
    description: "Indicatore radar di severita dei fenomeni grandinigeni.",
    cadence: "5 min",
    unit: "classe",
    wmsLayer: null,
    mapEnabled: false
  },
  {
    id: "POH",
    dataType: "it",
    label: "Probabilita grandine",
    shortLabel: "POH",
    description: "Probabilita radar di grandine.",
    cadence: "5 min",
    unit: "%",
    wmsLayer: null,
    mapEnabled: false
  },
  {
    id: "LTG",
    dataType: "it",
    label: "Fulmini",
    shortLabel: "LTG",
    description: "Densita o conteggio fulmini su griglia radar.",
    cadence: "5 min",
    unit: "conteggio",
    wmsLayer: null,
    mapEnabled: false
  }
];

function normalizeDpcDate(value) {
  if (!value) return null;
  const text = String(value);
  const valueWithZone = /Z|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`;
  const date = new Date(valueWithZone);
  return Number.isFinite(date.getTime()) ? date.toISOString() : text;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" }
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

function normalizeProductPayload(productConfig, payload) {
  if (!payload || typeof payload !== "object") return null;
  const normalizedDate = normalizeDpcDate(payload.date);

  return {
    id: payload.id ?? null,
    product: payload.product || productConfig.id,
    date: normalizedDate,
    wmsTime: normalizedDate,
    period: payload.period || null,
    quality: payload.quality ?? null,
    createdAt: normalizeDpcDate(payload.created_at),
    updatedAt: normalizeDpcDate(payload.updated_at),
    dataCount: Array.isArray(payload.data) ? payload.data.length : null
  };
}

function serializeProduct(product) {
  return {
    ...product,
    restLastUrl: `${DPC_REST_BASE}/${product.id}/${product.dataType}/last`,
    wmsBaseUrl: DPC_WMS_BASE,
    wmsCapabilitiesUrl: WMS_CAPABILITIES_URL
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedProduct = String(searchParams.get("product") || "SRI").toUpperCase();
  const product = PRODUCTS.find((item) => item.id === requestedProduct) || PRODUCTS[0];
  const errors = [];
  let lastProduct = null;

  try {
    const payload = await fetchJson(`${DPC_REST_BASE}/${product.id}/${product.dataType}/last`);
    lastProduct = normalizeProductPayload(product, payload);
  } catch (error) {
    errors.push({
      source: "DPC Radar REST",
      message: error.message
    });
  }

  return NextResponse.json(
    {
      source: "DPC Radar Protezione Civile",
      fetchedAt: new Date().toISOString(),
      product: serializeProduct(product),
      products: PRODUCTS.map(serializeProduct),
      lastProduct,
      services: {
        rest: DPC_REST_BASE,
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
