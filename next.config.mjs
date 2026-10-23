/** @type {import('next').NextConfig} */
const nextConfig = {
  // Import mirati: riduce il codice di Recharts e Leaflet trascinato nelle pagine.
  experimental: {
    optimizePackageImports: ["recharts", "lucide-react"]
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" }
    ]
  }
};

export default nextConfig;
