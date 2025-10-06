export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  xxl: "32px",
};

export const radii = {
  sm: "6px",
  md: "10px",
  lg: "16px",
  pill: "999px",
};

export const fontSizes = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.25rem",
  xl: "1.5rem",
  xxl: "2rem",
};

export const colors = {
  background: "#f4f6fb",
  surface: "#ffffff",
  surfaceAlt: "#f0f4f8",
  surfaceMuted: "#e5edf5",
  border: "#d6dee8",
  borderStrong: "#b1c3d6",
  textPrimary: "#1a2a3a",
  textSecondary: "#475569",
  textMuted: "#64748b",
  accent: "#0f766e",
  accentStrong: "#115e59",
  accentSoft: "#14b8a6",
  highlight: "#f59e0b",
  danger: "#dc2626",
  success: "#0e9f6e",
  info: "#2563eb",
};

export const shadows = {
  soft: "0 12px 30px rgba(15, 118, 110, 0.08)",
  inset: "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
};

export const tokens = {
  spacing,
  radii,
  fontSizes,
  colors,
  shadows,
};

export type ThemeTokens = typeof tokens;
