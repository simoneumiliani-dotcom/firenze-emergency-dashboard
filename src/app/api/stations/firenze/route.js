import { NextResponse } from "next/server";
import stationCatalog from "@/data/_MeteoHub.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...stationCatalog,
    count: stationCatalog.stations.length
  });
}
