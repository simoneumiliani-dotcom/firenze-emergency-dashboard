import { NextResponse } from "next/server";
import webcamCatalog from "@/data/webcams.json";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 8000;
const SAMPLE_BYTES = 4096;
const MIN_IMAGE_BYTES = 1024;

function withTimeout(ms = CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timeout) };
}

function resolveProbe(webcam) {
  if (webcam.embedMode === "image" && webcam.embedUrl) {
    return { url: webcam.embedUrl, mode: "image", expectedType: "image/" };
  }
  if (webcam.embedMode === "video" && webcam.embedUrl) {
    return { url: webcam.embedUrl, mode: "video", expectedType: "video/" };
  }
  return { url: webcam.checkUrl || webcam.sourceUrl, mode: "page", expectedType: null };
}

async function checkWebcam(webcam) {
  const timeout = withTimeout();
  const startedAt = Date.now();
  const probe = resolveProbe(webcam);

  try {
    const response = await fetch(probe.url, {
      cache: "no-store",
      signal: timeout.controller.signal,
      headers: {
        accept: probe.mode === "image" ? "image/*" : probe.mode === "video" ? "video/*" : "text/html,*/*;q=0.8",
        ...(probe.mode === "video" ? { range: `bytes=0-${SAMPLE_BYTES - 1}` } : {}),
        "user-agent": "Mozilla/5.0 FirenzeEmergencyDashboard/1.0"
      }
    });

    const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim();
    let bodyBytes = null;
    let validPayload = true;

    if (probe.mode === "image") {
      const buffer = Buffer.from(await response.arrayBuffer());
      bodyBytes = buffer.length;
      validPayload = buffer.length >= MIN_IMAGE_BYTES;
    } else if (probe.mode === "video") {
      const buffer = Buffer.from(await response.arrayBuffer());
      bodyBytes = buffer.length;
      validPayload = buffer.length > 0;
    } else {
      await response.body?.cancel();
    }

    const typeMatches = !probe.expectedType || contentType.startsWith(probe.expectedType);

    return {
      id: webcam.id,
      online: response.ok && typeMatches && validPayload,
      status: response.status,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      mode: probe.mode,
      checkedUrl: probe.url,
      contentType: contentType || null,
      bodyBytes,
      lastModified: response.headers.get("last-modified"),
      ...(response.ok && typeMatches && !validPayload ? { error: "payload_vuoto" } : {}),
      ...(response.ok && !typeMatches ? { error: "content_type_imprevisto:" + contentType } : {})
    };
  } catch (error) {
    return {
      id: webcam.id,
      online: false,
      status: null,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      mode: probe.mode,
      checkedUrl: probe.url,
      error: error?.name === "AbortError" ? "timeout" : "fetch_failed"
    };
  } finally {
    timeout.clear();
  }
}

export async function GET() {
  const results = await Promise.all((webcamCatalog.items || []).map(checkWebcam));

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    total: results.length,
    online: results.filter((item) => item.online).length,
    results
  }, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
