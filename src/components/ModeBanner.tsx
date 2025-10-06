import React from "react";

function getModeLabel(mode: string) {
  const normalized = mode.trim().toLowerCase();
  switch (normalized) {
    case "demo":
      return "Demo environment";
    case "staging":
      return "Staging environment";
    case "development":
      return "Development build";
    default:
      return mode;
  }
}

export default function ModeBanner() {
  const mode = process.env.APP_MODE?.trim();

  if (!mode || mode.toLowerCase() === "production") {
    return null;
  }

  return (
    <div
      style={{
        background: "#0f172a",
        color: "#f8fafc",
        textAlign: "center",
        padding: "0.35rem 1rem",
        fontSize: "0.85rem",
        letterSpacing: 0.4,
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {getModeLabel(mode)}
    </div>
  );
}
