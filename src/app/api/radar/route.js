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

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/xml,text/xml,text/plain,*/*" }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(("HTTP " + response.status + " " + text.slice(0, 240)).trim());
    }
    return text;
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

function extractWmsTimeForLayer(xml, layerName) {
  if (!xml || !layerName) return null;
  const layerIndex = xml.indexOf(`<Name>${layerName}</Name>`);
  if (layerIndex < 0) return null;
  const layerChunk = xml.slice(Math.max(0, layerIndex - 2500), layerIndex + 12000);
  const timeMatch = layerChunk.match(/<(?:Dimension|Extent)\b[^>]*name=["']time["'][^>]*>([\s\S]*?)<\/(?:Dimension|Extent)>/i);
  const defaultMatch = layerChunk.match(/<(?:Dimension|Extent)\b[^>]*name=["']time["'][^>]*default=["']([^"']+)["'][^>]*>/i);
  const defaultTime = normalizeDpcDate(defaultMatch?.[1]);
  if (defaultTime) return defaultTime;

  const rawValue = timeMatch?.[1]?.trim();
  if (!rawValue) return null;
  const candidates = rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const lastCandidate = candidates[candidates.length - 1];
  return normalizeDpcDate(lastCandidate);
}

async function fetchLatestWmsTime(product) {
  if (!product?.wmsLayer) return null;
  const xml = await fetchText(WMS_CAPABILITIES_URL);
  const wmsTime = extractWmsTimeForLayer(xml, product.wmsLayer);
  if (!wmsTime) throw new Error("WMS capabilities senza dimensione time leggibile per " + product.wmsLayer);
  return {
    id: null,
    product: product.id,
    date: wmsTime,
    wmsTime,
    period: null,
    quality: null,
    createdAt: null,
    updatedAt: null,
    dataCount: null,
    sourceType: "wms_capabilities"
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

    try {
      lastProduct = await fetchLatestWmsTime(product);
    } catch (wmsError) {
      errors.push({
        source: "DPC Radar WMS capabilities",
        message: wmsError.message
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
