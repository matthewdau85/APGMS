import * as Dialog from "@radix-ui/react-dialog";
import { useState, type CSSProperties } from "react";
import { useConsoleData } from "../api/client";

const overlayStyle: CSSProperties = {
  backgroundColor: "rgba(15, 23, 42, 0.45)",
  position: "fixed",
  inset: 0,
};

const contentStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "0.75rem",
  boxShadow: "0 30px 60px rgba(15, 23, 42, 0.25)",
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(680px, 90vw)",
  maxHeight: "80vh",
  padding: "1.5rem",
  overflowY: "auto",
};

const statusColorMap: Record<string, string> = {
  online: "#0f766e",
  degraded: "#b45309",
  offline: "#b91c1c",
};

export default function CapabilityMatrixPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useConsoleData();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.45rem 0.9rem",
            borderRadius: "0.5rem",
            border: "1px solid #cbd5f5",
            backgroundColor: "white",
            color: "#1d4ed8",
            fontWeight: 600,
            cursor: "pointer",
            transition: "background-color 0.15s ease",
            boxShadow: open ? "0 0 0 2px rgba(59,130,246,0.2)" : "none",
          }}
        >
          ⓘ Capability Matrix
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <Dialog.Title style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              Capability Matrix
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close capability matrix"
              style={{
                border: "none",
                background: "transparent",
                fontSize: "1.25rem",
                cursor: "pointer",
                color: "#64748b",
              }}
            >
              ×
            </Dialog.Close>
          </div>
          <p style={{ marginTop: "0.5rem", color: "#475569" }}>
            Consolidated view of operational capabilities across the APGMS platform.
          </p>

          <div style={{ marginTop: "1.5rem", display: "grid", gap: "1rem" }}>
            {isLoading && <div>Loading capability status…</div>}
            {!isLoading && data?.capabilityMatrix.map((capability) => (
              <div
                key={capability.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{capability.name}</div>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0.25rem 0.65rem",
                      borderRadius: "999px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: "white",
                      backgroundColor: statusColorMap[capability.status] ?? "#475569",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: "0.5rem",
                        height: "0.5rem",
                        borderRadius: "999px",
                        backgroundColor: "white",
                        opacity: 0.8,
                      }}
                    />
                    {capability.status.toUpperCase()}
                  </span>
                </div>
                <p style={{ margin: 0, color: "#475569", lineHeight: 1.4 }}>{capability.summary}</p>
              </div>
            ))}
            {!isLoading && !data?.capabilityMatrix.length && (
              <div style={{ color: "#94a3b8" }}>No capability data is available right now.</div>
            )}
          </div>

          {data?.lastUpdated ? (
            <footer style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#94a3b8" }}>
              Last refreshed {new Date(data.lastUpdated).toLocaleString()}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
