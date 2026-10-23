import "./globals.css";
import "leaflet/dist/leaflet.css";
import ConnectionBanner from "@/components/ConnectionBanner";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

export const metadata = {
  applicationName: "Allerta Meteo Firenze",
  title: {
    default: "Allerta Meteo Firenze",
    template: "%s | Allerta Meteo Firenze"
  },
  description: "Dashboard operativa per monitoraggio meteo, idrometrico e rischi territoriali nella Provincia di Firenze.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    title: "Allerta FI",
    statusBarStyle: "black-translucent"
  },
  formatDetection: {
    telephone: false
  },
  other: {
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#08111f"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale non va limitato: su tablet e telefono il pinch-zoom deve restare
  // disponibile (WCAG 1.4.4) per leggere tabelle e valori piccoli.
  themeColor: "#08111f"
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>
        {children}
        <ConnectionBanner />
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
