import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./apps/web/console/index.html",
    "./apps/web/console/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
        mono: ["var(--font-mono)", ...defaultTheme.fontFamily.mono],
      },
      colors: {
        bg: "var(--color-bg)",
        fg: "var(--color-fg)",
        muted: {
          DEFAULT: "var(--color-muted)",
          fg: "var(--color-muted-fg)",
          border: "var(--color-muted-border)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          fg: "var(--color-accent-fg)",
          soft: "var(--color-accent-soft)",
        },
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-danger)",
        info: "var(--color-info)",
        overlay: "var(--color-overlay)",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        DEFAULT: "var(--radius)",
        md: "calc(var(--radius) + 2px)",
        lg: "calc(var(--radius) + 6px)",
        xl: "calc(var(--radius) + 10px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        inner: "var(--shadow-inset)",
      },
    },
  },
  plugins: [],
};

export default config;
