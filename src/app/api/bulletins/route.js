import { NextResponse } from "next/server";
import { getBulletinArchive, saveBulletinToArchive } from "@/lib/bulletinArchive";

export const dynamic = "force-dynamic";

export async function GET() {
  const archive = await getBulletinArchive();
  return NextResponse.json(archive);
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const archive = await saveBulletinToArchive(payload);
    return NextResponse.json(archive);
  } catch (error) {
    return NextResponse.json(
      { error: "Impossibile salvare il bollettino nell'archivio." },
      { status: 400 }
    );
  }
}
