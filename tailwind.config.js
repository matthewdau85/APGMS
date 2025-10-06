require("ts-node").register({ transpileOnly: true });
const { tokens } = require("./src/ui/tokens");

const spacing = tokens.space;
const borderRadius = tokens.radius;
const boxShadow = tokens.shadow;
const zIndex = tokens.zIndex;
const transitionDuration = tokens.durations;
const screens = tokens.breakpoints;

const colors = Object.fromEntries(
  [
    "background",
    "foreground",
    "subtle",
    "muted",
    "border",
    "primary",
    "primaryContrast",
    "critical",
    "warning",
    "success",
    "info",
  ].map((token) => [token, `var(--color-${token})`]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      spacing,
      borderRadius,
      boxShadow,
      zIndex,
      transitionDuration,
      colors,
    },
    screens,
  },
  plugins: [],
};
