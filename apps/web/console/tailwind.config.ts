import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#38bdf8",
          muted: "#1e293b",
          accent: "#facc15",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
