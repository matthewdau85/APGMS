import React, { useState } from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Compliance & audit",
  helpSlug: "audit-log",
};

const panelStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radii.lg,
  boxShadow: shadows.soft,
  padding: spacing.xl,
  display: "flex",
  flexDirection: "column",
  gap: spacing.md,
};

export default function Audit() {
  const [logs] = useState(
    [
      { date: "1 May 2025", action: "Transferred $1,000 to PAYGW buffer" },
      { date: "10 May 2025", action: "Lodged BAS (Q3 FY24-25)" },
      { date: "15 May 2025", action: "Audit log downloaded by user" },
      { date: "22 May 2025", action: "Reminder sent: PAYGW payment due" },
      { date: "29 May 2025", action: "BAS lodged (on time)" },
      { date: "5 June 2025", action: "Scheduled PAYGW transfer" },
      { date: "16 June 2025", action: "GST payment confirmed" },
    ] satisfies Array<{ date: string; action: string }>
  );

  return (
    <Page
      meta={meta}
      breadcrumbs={[{ label: "Compliance" }, { label: "Audit log" }]}
      actions={
        <button
          type="button"
          style={{
            padding: `${spacing.sm} ${spacing.lg}`,
            borderRadius: radii.md,
            border: `1px solid ${colors.accent}`,
            background: "transparent",
            color: colors.accent,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Download full log
        </button>
      }
    >
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={panelStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Audit trail</h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Every PAYGW and GST action is captured to help you demonstrate compliance with ATO record-keeping requirements.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: fontSizes.sm,
                color: colors.textSecondary,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: `${spacing.sm} ${spacing.md}`,
                      borderBottom: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                    }}
                  >
                    Date
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: `${spacing.sm} ${spacing.md}`,
                      borderBottom: `1px solid ${colors.border}`,
                      color: colors.textPrimary,
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={`${log.date}-${log.action}`}>
                    <td style={{ padding: `${spacing.sm} ${spacing.md}`, borderBottom: `1px solid ${colors.border}` }}>
                      {log.date}
                    </td>
                    <td style={{ padding: `${spacing.sm} ${spacing.md}`, borderBottom: `1px solid ${colors.border}` }}>
                      {log.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div style={panelStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Escalation guidance</h3>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Use the audit trail with your advisor or the ATO if evidence is requested. Capture supporting documents in the Evidence workspace to close out anomalies quickly.
          </p>
        </div>
      </div>
    </Page>
  );
}
