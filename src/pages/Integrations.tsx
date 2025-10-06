import React from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Integrations",
  helpSlug: "integrations",
};

const cardStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radii.lg,
  boxShadow: shadows.soft,
  padding: spacing.xl,
  display: "flex",
  flexDirection: "column",
  gap: spacing.md,
};

const connectors = [
  { name: "MYOB", category: "Payroll" },
  { name: "QuickBooks", category: "Payroll" },
  { name: "Square", category: "Point of sale" },
  { name: "Vend", category: "Point of sale" },
];

export default function Integrations() {
  return (
    <Page meta={meta} breadcrumbs={[{ label: "Workspace" }, { label: "Integrations" }]}>
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Connect providers</h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Bring payroll and sales data into APGMS so lodgments and payments stay in sync.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing.sm }}>
            {connectors.map((connector) => (
              <li
                key={connector.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: colors.surfaceAlt,
                  borderRadius: radii.md,
                  padding: `${spacing.sm} ${spacing.md}`,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{connector.name}</p>
                  <p style={{ margin: 0, fontSize: fontSizes.xs, color: colors.textSecondary }}>{connector.category}</p>
                </div>
                <button
                  type="button"
                  style={{
                    padding: `${spacing.xs} ${spacing.md}`,
                    borderRadius: radii.pill,
                    border: "none",
                    background: colors.accent,
                    color: colors.surface,
                    fontSize: fontSizes.xs,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Connect
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Upcoming integrations</h3>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Xero payroll, Deputy timesheets and Shopify POS are scheduled for the next release.
          </p>
        </div>
      </div>
    </Page>
  );
}
