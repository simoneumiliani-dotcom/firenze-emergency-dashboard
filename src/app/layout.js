import "./globals.css";
import "leaflet/dist/leaflet.css";

export const metadata = {
  title: "Allerta Meteo Firenze",
  description: "Dashboard operativa per monitoraggio meteo, idrometrico e rischi territoriali nella Provincia di Firenze."
};

export default function RootLayout({ children }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
