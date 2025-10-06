import React from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Activity feed",
  helpSlug: "activity",
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

const activities = [
  {
    title: "PAYGW sweep completed",
    detail: "Transferred $1,000 to PAYGW buffer",
    timestamp: "05 Jun 2025",
  },
  {
    title: "GST invoices uploaded",
    detail: "3 invoices added to Evidence workspace",
    timestamp: "03 Jun 2025",
  },
  {
    title: "BAS review due",
    detail: "Q4 FY24 BAS ready for submission",
    timestamp: "01 Jun 2025",
  },
];

export default function Activity() {
  return (
    <Page meta={meta} breadcrumbs={[{ label: "Compliance" }, { label: "Activity" }]}> 
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={panelStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Recent activity</h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Track lodgments, payments and evidence updates in one stream.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing.sm }}>
            {activities.map((item) => (
              <li
                key={`${item.timestamp}-${item.title}`}
                style={{
                  borderRadius: radii.md,
                  border: `1px solid ${colors.border}`,
                  padding: `${spacing.sm} ${spacing.md}`,
                  background: colors.surfaceAlt,
                  display: "flex",
                  flexDirection: "column",
                  gap: spacing.xs,
                }}
              >
                <span style={{ fontSize: fontSizes.xs, color: colors.textMuted }}>{item.timestamp}</span>
                <strong style={{ color: colors.textPrimary }}>{item.title}</strong>
                <span style={{ fontSize: fontSizes.sm, color: colors.textSecondary }}>{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <div style={panelStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Automation health</h3>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            No automation failures detected this week. Alerts from fraud monitoring will appear here with remediation steps.
          </p>
        </div>
      </div>
    </Page>
  );
}
