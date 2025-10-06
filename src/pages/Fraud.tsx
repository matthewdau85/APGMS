import React, { useState } from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Fraud monitoring",
  helpSlug: "fraud-detection",
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

export default function Fraud() {
  const [alerts] = useState(
    [
      { date: "02 Jun 2025", detail: "PAYGW sweep skipped by bank rules" },
      { date: "16 May 2025", detail: "GST transfer 35% below forecast" },
    ] satisfies Array<{ date: string; detail: string }>
  );

  return (
    <Page meta={meta} breadcrumbs={[{ label: "Compliance" }, { label: "Fraud" }]}> 
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={panelStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Active alerts</h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Monitor transfer anomalies and potential fraud events. Investigate alerts promptly to avoid interest or penalties.
          </p>
          <ul style={{ margin: 0, paddingLeft: "20px", color: colors.highlight, fontWeight: 600 }}>
            {alerts.map((alert) => (
              <li key={`${alert.date}-${alert.detail}`} style={{ marginBottom: spacing.xs }}>
                <span style={{ color: colors.textPrimary }}>{alert.date}</span>: {alert.detail}
              </li>
            ))}
          </ul>
        </div>
        <div style={panelStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>What happens next</h3>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Machine learning scoring is scheduled to extend these alerts with predictive risk ratings. Continue capturing evidence of transfers to support any ATO review.
          </p>
        </div>
      </div>
    </Page>
  );
}
