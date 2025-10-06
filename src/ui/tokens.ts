import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemeName = "light" | "dark";

type TokenDictionary = {
  space: Record<string, string>;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  zIndex: Record<string, number>;
  durations: Record<string, string>;
  breakpoints: Record<string, string>;
};

type ThemePalette = {
  background: string;
  foreground: string;
  subtle: string;
  muted: string;
  border: string;
  primary: string;
  primaryContrast: string;
  critical: string;
  warning: string;
  success: string;
  info: string;
};

type ThemeConfig = {
  name: ThemeName;
  palette: ThemePalette;
};

export const tokens: TokenDictionary = {
  space: {
    0: "0px",
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.5rem",
    6: "2rem",
    7: "3rem",
    8: "4rem",
  },
  radius: {
    none: "0px",
    xs: "2px",
    sm: "4px",
    md: "8px",
    lg: "12px",
    xl: "16px",
    full: "999px",
  },
  shadow: {
    none: "none",
    xs: "0 1px 2px rgba(15, 23, 42, 0.05)",
    sm: "0 1px 3px rgba(15, 23, 42, 0.12)",
    md: "0 10px 30px rgba(15, 23, 42, 0.12)",
  },
  zIndex: {
    base: 0,
    dropdown: 10,
    overlay: 20,
    modal: 30,
    toast: 40,
  },
  durations: {
    instant: "0ms",
    fast: "100ms",
    base: "200ms",
    slow: "350ms",
  },
  breakpoints: {
    xs: "320px",
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
  },
};

const themePalette: Record<ThemeName, ThemePalette> = {
  light: {
    background: "#f5f7fa",
    foreground: "#1f2937",
    subtle: "#e2e8f0",
    muted: "#64748b",
    border: "#cbd5f5",
    primary: "#00716b",
    primaryContrast: "#ffffff",
    critical: "#ef4444",
    warning: "#f59e0b",
    success: "#10b981",
    info: "#2563eb",
  },
  dark: {
    background: "#0f172a",
    foreground: "#f8fafc",
    subtle: "#1e293b",
    muted: "#94a3b8",
    border: "#1e3a8a",
    primary: "#38bdf8",
    primaryContrast: "#02131d",
    critical: "#f87171",
    warning: "#fbbf24",
    success: "#34d399",
    info: "#60a5fa",
  },
};

const themes: Record<ThemeName, ThemeConfig> = {
  light: { name: "light", palette: themePalette.light },
  dark: { name: "dark", palette: themePalette.dark },
};

type ThemeContextValue = {
  theme: ThemeConfig;
  setTheme: (theme: ThemeName) => void;
  tokens: TokenDictionary;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches;

const applyTokensToDocument = (theme: ThemeConfig) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.dataset.theme = theme.name;

  Object.entries(tokens.space).forEach(([key, value]) => {
    root.style.setProperty(`--space-${key}`, value);
  });

  Object.entries(tokens.radius).forEach(([key, value]) => {
    root.style.setProperty(`--radius-${key}`, value);
  });

  Object.entries(tokens.shadow).forEach(([key, value]) => {
    root.style.setProperty(`--shadow-${key}`, value);
  });

  Object.entries(tokens.durations).forEach(([key, value]) => {
    root.style.setProperty(`--duration-${key}`, value);
  });

  Object.entries(tokens.breakpoints).forEach(([key, value]) => {
    root.style.setProperty(`--breakpoint-${key}`, value);
  });

  Object.entries(theme.palette).forEach(([key, value]) => {
    root.style.setProperty(`--color-${key}`, value);
  });
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(() =>
    prefersDark() ? "dark" : "light",
  );

  useEffect(() => {
    const listener = (event: MediaQueryListEvent) => {
      setThemeName(event.matches ? "dark" : "light");
    };

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", listener);
    return () => media?.removeEventListener("change", listener);
  }, []);

  const theme = useMemo(() => themes[themeName], [themeName]);

  useEffect(() => {
    applyTokensToDocument(theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      tokens,
      setTheme: (name: ThemeName) => setThemeName(name),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}

export const themeNames: ThemeName[] = ["light", "dark"];
export type { ThemeName, ThemeConfig, TokenDictionary, ThemePalette };
