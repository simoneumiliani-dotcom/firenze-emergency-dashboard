/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/app/**/*.{js,jsx}",
    "./src/components/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        emergency: {
          ink: "#07111f",
          panel: "#0d1728",
          panel2: "#121f34",
          line: "#26364f",
          yellow: "#facc15",
          orange: "#fb923c",
          red: "#ef4444",
          green: "#22c55e"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(148,163,184,.16), 0 20px 60px rgba(0,0,0,.35)"
      }
    }
  },
  plugins: []
};
