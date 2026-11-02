/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#0a100d", 900: "#0e1612", 800: "#131d18", 700: "#1a2720", 600: "#243629" },
        moss: { 400: "#6fcf97", 500: "#34d399", 600: "#10b981" },
        earth: { 300: "#d9c7a3", 400: "#c2a878", 500: "#9c8559" },
        warn: "#f5b041", crit: "#f87171",
      },
      fontFamily: {
        display: ["Noto Sans", "Noto Sans Tamil", "system-ui", "sans-serif"],
        sans: ["Noto Sans", "Noto Sans Tamil", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
