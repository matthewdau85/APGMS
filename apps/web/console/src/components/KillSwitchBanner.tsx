import { useConsoleData } from "../api/client";

export default function KillSwitchBanner() {
  const { data, isLoading } = useConsoleData();

  if (isLoading) {
    return (
      <div
        role="status"
        style={{
          backgroundColor: "#fff3cd",
          border: "1px solid #ffe69c",
          color: "#664d03",
          padding: "0.75rem 1rem",
          borderRadius: "0.5rem",
          marginBottom: "1rem",
        }}
      >
        Checking safeguards…
      </div>
    );
  }

  if (!data?.killSwitch.active) {
    return null;
  }

  return (
    <div
      role="alert"
      style={{
        backgroundColor: "#f8d7da",
        border: "1px solid #f5c2c7",
        color: "#842029",
        padding: "0.75rem 1rem",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <strong>Kill Switch Engaged.</strong>
      <div>{data.killSwitch.message ?? "All outbound operations are halted."}</div>
      {data.killSwitch.activatedAt ? (
        <div style={{ fontSize: "0.8rem", opacity: 0.8, marginTop: "0.25rem" }}>
          Activated at {new Date(data.killSwitch.activatedAt).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}
