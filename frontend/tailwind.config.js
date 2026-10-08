/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070c09", 900: "#0b110e", 800: "#101a15", 700: "#16241d", 600: "#1f3329" },
        moss: { 400: "#6fcf97", 500: "#34d399", 600: "#10b981" },
        earth: { 300: "#d9c7a3", 400: "#c2a878", 500: "#9c8559" },
        warn: "#f5b041", crit: "#ef4444",
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
