export function ModeBanner({ mode }: { mode: string }) {
  return (
    <div
      style={{
        padding: 8,
        fontWeight: 600,
        background: mode === "prototype" ? "#fde047" : "#86efac",
      }}
    >
      {mode === "prototype"
        ? "Prototype mode — mock data"
        : "Real mode — live data"}
    </div>
  );
}
