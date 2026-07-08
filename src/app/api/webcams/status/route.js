import { NextResponse } from "next/server";
import webcamCatalog from "@/data/webcams.json";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 6000;

function withTimeout(ms = CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timeout) };
}

async function checkWebcam(webcam) {
  const timeout = withTimeout();
  const startedAt = Date.now();

  try {
    const response = await fetch(webcam.checkUrl || webcam.sourceUrl, {
      cache: "no-store",
      signal: timeout.controller.signal,
      headers: {
        accept: "text/html,image/*,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 FirenzeEmergencyDashboard/1.0"
      }
    });

    return {
      id: webcam.id,
      online: response.ok,
      status: response.status,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      id: webcam.id,
      online: false,
      status: null,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
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
