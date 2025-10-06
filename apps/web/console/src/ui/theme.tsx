import React from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined,
);

const storageKey = "apgms-console-theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: "light" | "dark") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = React.useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(storageKey) as ThemeMode | null;
    return stored ?? "system";
  });

  const [resolved, setResolved] = React.useState<"light" | "dark">(() =>
    mode === "system" ? getSystemTheme() : mode,
  );

  React.useEffect(() => {
    const resolvedMode = mode === "system" ? getSystemTheme() : mode;
    setResolved(resolvedMode);
    applyTheme(resolvedMode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, mode);
    }
  }, [mode]);

  React.useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setResolved(mql.matches ? "dark" : "light");
    listener();
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [mode]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolved,
      setMode,
      toggle: () =>
        setMode((prev) =>
          prev === "dark" ? "light" : prev === "light" ? "system" : "dark",
        ),
    }),
    [mode, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
