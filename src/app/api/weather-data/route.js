import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const LOCATIONS = [
  { id: "firenze", name: "Firenze", lat: 43.7696, lng: 11.2558 },
  { id: "sesto-fiorentino", name: "Sesto Fiorentino", lat: 43.8333, lng: 11.2000 },
  { id: "scandicci", name: "Scandicci", lat: 43.7542, lng: 11.1879 },
  { id: "bagno-a-ripoli", name: "Bagno a Ripoli", lat: 43.7512, lng: 11.3225 },
  { id: "empoli", name: "Empoli", lat: 43.7179, lng: 10.9476 },
  { id: "borgo-san-lorenzo", name: "Borgo S. Lorenzo", lat: 43.9555, lng: 11.3856 },
  { id: "greve-in-chianti", name: "Greve in Chianti", lat: 43.5851, lng: 11.3171 },
  { id: "pontassieve", name: "Pontassieve", lat: 43.7748, lng: 11.4381 }
];

function pickCurrentHour(hourly) {
  const now = new Date();
  const index = hourly.time.findIndex((time) => new Date(time) >= now);
  return index > 0 ? index - 1 : 0;
}

async function fetchOpenMeteo(location) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lng),
    hourly: "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,snowfall",
    forecast_days: "2",
    timezone: "Europe/Rome"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    cache: "no-store"
  });

  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const payload = await response.json();
  const currentIndex = pickCurrentHour(payload.hourly);

  return {
    ...location,
    source: "Open-Meteo",
    updatedAt: new Date().toLocaleString("it-IT"),
    current: {
      time: payload.hourly.time[currentIndex],
      temperature: payload.hourly.temperature_2m[currentIndex],
      humidity: payload.hourly.relative_humidity_2m[currentIndex],
      precipitation: payload.hourly.precipitation[currentIndex],
      windSpeed: payload.hourly.wind_speed_10m[currentIndex],
      snowfall: payload.hourly.snowfall[currentIndex]
    },
    hourly: payload.hourly.time.slice(currentIndex, currentIndex + 12).map((time, index) => {
      const cursor = currentIndex + index;
      return {
        time,
        temperature: payload.hourly.temperature_2m[cursor],
        humidity: payload.hourly.relative_humidity_2m[cursor],
        precipitation: payload.hourly.precipitation[cursor],
        windSpeed: payload.hourly.wind_speed_10m[cursor],
        snowfall: payload.hourly.snowfall[cursor]
      };
    })
  };
}

export async function GET() {
  try {
    const locations = await Promise.all(LOCATIONS.map(fetchOpenMeteo));
    return NextResponse.json({
      source: "Open-Meteo",
      fetchedAt: new Date().toLocaleString("it-IT"),
      locations
    });
  } catch (error) {
    return NextResponse.json({
      source: "Open-Meteo",
      fetchedAt: new Date().toLocaleString("it-IT"),
      warning: "Previsioni Open-Meteo non disponibili in questo momento.",
      locations: []
    });
  }
}
