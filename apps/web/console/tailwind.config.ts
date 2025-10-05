import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#0A67A3",
          accent: "#14B8A6",
          surface: "#F2F9FD"
        }
      }
    }
  },
  plugins: [],
};

export default config;
