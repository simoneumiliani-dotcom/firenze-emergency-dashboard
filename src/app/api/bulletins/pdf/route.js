import { NextResponse } from "next/server";
import { getBulletinArchive } from "@/lib/bulletinArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ID = 220;

function badRequest(status, error) {
  return NextResponse.json({ error }, { status });
}

function safeFileName(value) {
  const name = String(value || "bollettino.pdf").replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 120);
  return name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf";
}

export async function GET(request) {
  const id = String(new URL(request.url).searchParams.get("id") || "").trim().slice(0, MAX_ID);
  if (!id) return badRequest(400, "Identificativo del bollettino mancante.");

  const archive = await getBulletinArchive();
  const record = [...(archive.items || []), archive.current].filter(Boolean).find((item) => item.id === id);
  if (!record) return badRequest(404, "Bollettino non trovato nell'archivio.");

  const pdfUrl = record.pdfUrl;
  if (typeof pdfUrl === "string" && /^https:\/\//i.test(pdfUrl)) {
    return NextResponse.redirect(pdfUrl);
  }

  const base64 = typeof pdfUrl === "string" && pdfUrl.startsWith("data:")
    ? pdfUrl.replace(/^data:[^,]*,/, "")
    : null;
  if (!base64) return badRequest(404, "PDF non disponibile per questo bollettino.");

  let bytes;
  try {
    bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return badRequest(500, "PDF del bollettino non leggibile.");
  }

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline; filename=\"" + safeFileName(record.fileName) + "\"",
      // Il PDF di un record archiviato non cambia: puo' stare in cache a lungo.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400"
    }
  });
}
