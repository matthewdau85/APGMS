import React from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Evidence workspace",
  helpSlug: "evidence",
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

const documents = [
  { name: "Payroll summary - May 2025", type: "PAYGW", status: "Verified" },
  { name: "GST invoices - Q4 FY24", type: "GST", status: "Pending review" },
  { name: "Bank transfer confirmations", type: "PAYGW", status: "Verified" },
];

export default function Evidence() {
  return (
    <Page
      meta={meta}
      breadcrumbs={[{ label: "Compliance" }, { label: "Evidence" }]}
      actions={
        <button
          type="button"
          style={{
            padding: `${spacing.sm} ${spacing.lg}`,
            borderRadius: radii.md,
            border: "none",
            background: colors.accent,
            color: colors.surface,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Upload evidence
        </button>
      }
    >
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div style={cardStyle}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Evidence library</h2>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Store statements, invoices and payroll reports that support PAYGW and GST submissions.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: spacing.sm }}>
            {documents.map((document) => (
              <li
                key={document.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: `${spacing.sm} ${spacing.md}`,
                  borderRadius: radii.md,
                  background: colors.surfaceAlt,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{document.name}</p>
                  <p style={{ margin: 0, fontSize: fontSizes.xs, color: colors.textSecondary }}>{document.type}</p>
                </div>
                <span
                  style={{
                    fontSize: fontSizes.xs,
                    fontWeight: 600,
                    color: document.status === "Verified" ? colors.success : colors.highlight,
                  }}
                >
                  {document.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Tips</h3>
          <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
            Capture evidence for every PAYGW and GST transfer. Link the documents to activity feed items for quick audits.
          </p>
        </div>
      </div>
    </Page>
  );
}
