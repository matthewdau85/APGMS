import { useMemo } from "react";
import { useConsoleData } from "../api/client";

type ToneColor = {
  background: string;
  color: string;
  border: string;
};

function toneToColors(tone: string): ToneColor {
  switch (tone) {
    case "maintenance":
      return { background: "#fff8e1", color: "#8a6100", border: "#f5d47a" };
    case "emergency":
      return { background: "#fde4e4", color: "#a30d0d", border: "#f4b3b3" };
    default:
      return { background: "#e8f5e9", color: "#1b5e20", border: "#c8e6c9" };
  }
}

export default function ModePill() {
  const { data, isLoading } = useConsoleData();

  const { background, color, border } = useMemo(() => {
    const tone = data?.mode.tone ?? "operational";
    return toneToColors(tone);
  }, [data?.mode.tone]);

  return (
    <span
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.35rem 0.75rem",
        borderRadius: "9999px",
        fontSize: "0.85rem",
        fontWeight: 600,
        backgroundColor: background,
        color,
        border: `1px solid ${border}`,
        minWidth: "7rem",
        justifyContent: "center",
      }}
    >
      {isLoading ? "Loading…" : data?.mode.label ?? "Unknown"}
    </span>
  );
}
