import React from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Help & guidance",
  helpSlug: "help",
};

const cardStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radii.lg,
  boxShadow: shadows.soft,
  padding: spacing.xl,
  display: "flex",
  flexDirection: "column",
  gap: spacing.sm,
};

export default function Help() {
  return (
    <Page meta={meta} breadcrumbs={[{ label: "Support" }, { label: "Help" }]}>
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Getting started</h2>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: fontSizes.sm, color: colors.textSecondary }}>
            <li>Complete the setup wizard to align PAYGW and GST accounts.</li>
            <li>Review the dashboard weekly for outstanding lodgments.</li>
            <li>Capture evidence for invoices and payroll in the Evidence workspace.</li>
          </ul>
        </div>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>ATO compliance</h2>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: fontSizes.sm, color: colors.textSecondary }}>
            <li>Maintain one-way accounts to protect withheld funds.</li>
            <li>Use the audit log when responding to ATO reviews.</li>
            <li>Stay ahead of BAS due dates with scheduled transfers.</li>
          </ul>
        </div>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Support links</h2>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: fontSizes.sm }}>
            <li>
              <a href="https://www.ato.gov.au/business/payg-withholding/" style={{ color: colors.accent }}>
                ATO PAYGW guide
              </a>
            </li>
            <li>
              <a href="https://www.ato.gov.au/business/gst/" style={{ color: colors.accent }}>
                ATO GST information
              </a>
            </li>
            <li>
              <a
                href="https://www.ato.gov.au/business/business-activity-statements-(bas)/"
                style={{ color: colors.accent }}
              >
                ATO BAS portal
              </a>
            </li>
            <li>
              <a href="https://www.ato.gov.au/General/Online-services/" style={{ color: colors.accent }}>
                ATO online services
              </a>
            </li>
          </ul>
        </div>
      </div>
    </Page>
  );
}
