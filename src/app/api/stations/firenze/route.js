import { NextResponse } from "next/server";
import stationCatalog from "@/data/firenzeStations.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ...stationCatalog,
    count: stationCatalog.stations.length
  });
}
