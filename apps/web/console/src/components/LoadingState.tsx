import React from "react";

export function LoadingState({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        border: "2px solid #cbd5f5",
        borderTopColor: "transparent",
        animation: "spin 1s linear infinite",
      }}
    />
  );
}
