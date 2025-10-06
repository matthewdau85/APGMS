import React from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Business Activity Statement",
  helpSlug: "bas-overview",
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

export default function BAS() {
  const summary = [
    { label: "W1 Gross wages", value: "$7,500" },
    { label: "W2 PAYGW withheld", value: "$1,850" },
    { label: "G1 Total sales", value: "$25,000" },
    { label: "1A GST on sales", value: "$2,500" },
    { label: "1B GST on purchases", value: "$450" },
  ];

  return (
    <Page
      meta={meta}
      breadcrumbs={[{ label: "Compliance" }, { label: "BAS" }]}
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
          Prepare next BAS
        </button>
      }
    >
      <section
        style={{
          display: "grid",
          gap: spacing.xl,
        }}
      >
        <div style={{ ...cardStyle, borderLeft: `4px solid ${colors.highlight}` }}>
          <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Current quarter summary</h2>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: fontSizes.sm, color: colors.textSecondary }}>
            {summary.map((item) => (
              <li key={item.label}>
                <strong>{item.label}:</strong> {item.value}
              </li>
            ))}
          </ul>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: spacing.lg,
          }}
        >
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Lodgment</h3>
            <p style={{ margin: 0, color: colors.danger }}>Overdue</p>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Last lodged 29 May 2025
            </p>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Payments</h3>
            <p style={{ margin: 0, color: colors.danger }}>Outstanding</p>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              $1,600 scheduled to transfer this week
            </p>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Compliance score</h3>
            <p style={{ margin: 0, fontSize: fontSizes.xxl, fontWeight: 600, color: colors.accentStrong }}>65%</p>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Needs attention this fortnight
            </p>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Next steps</h3>
          <ol style={{ margin: 0, paddingLeft: "20px", fontSize: fontSizes.sm, color: colors.textSecondary }}>
            <li>Review payroll data and confirm PAYGW totals.</li>
            <li>Upload invoices for GST credits to the Evidence workspace.</li>
            <li>Schedule payment from PAYGW buffer account before 28 July 2025.</li>
          </ol>
        </div>
      </section>
    </Page>
  );
}
