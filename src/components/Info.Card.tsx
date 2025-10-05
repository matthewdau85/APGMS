import React from "react";
export function InfoCard({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{
      background: "#f6f6f6", borderRadius: 12, boxShadow: "0 1px 7px #00205b08",
      padding: 28, marginBottom: 20
    }}>
      <h2 style={{ color: "#00716b", fontWeight: 700, fontSize: 22, marginBottom: 18 }}>{title}</h2>
      {children}
    </div>
  );
}
