// src/pages/Dashboard.tsx
import React from "react";
import { Link } from "react-router-dom";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Compliance dashboard",
  helpSlug: "dashboard-overview",
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

export default function Dashboard() {
  const complianceStatus = {
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    overallCompliance: 65,
    lastBAS: "29 May 2025",
    nextDue: "28 July 2025",
    outstandingLodgments: ["Q4 FY23-24"],
    outstandingAmounts: ["$1,200 PAYGW", "$400 GST"],
  };

  return (
    <Page
      meta={meta}
      actions={
        <Link
          to="/wizard"
          style={{
            textDecoration: "none",
            padding: `${spacing.sm} ${spacing.lg}`,
            background: colors.accent,
            color: colors.surface,
            borderRadius: radii.md,
            fontWeight: 600,
          }}
        >
          Launch compliance wizard
        </Link>
      }
    >
      <section
        style={{
          display: "grid",
          gap: spacing.xl,
        }}
      >
        <div style={{ ...cardStyle, background: colors.accent, color: colors.surface }}>
          <p
            style={{
              margin: 0,
              fontSize: fontSizes.sm,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              opacity: 0.9,
            }}
          >
            Welcome back
          </p>
          <h2
            style={{
              margin: 0,
              fontSize: fontSizes.xl,
            }}
          >
            Automated PAYGW & GST compliance status
          </h2>
          <p style={{ margin: 0, fontSize: fontSizes.sm, opacity: 0.9 }}>
            Stay on track with lodgments, payments and evidence collection. The activity feed highlights what needs attention.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: spacing.lg,
          }}
        >
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg, color: colors.textPrimary }}>
              Lodgments
            </h3>
            <p style={{ margin: 0, color: complianceStatus.lodgmentsUpToDate ? colors.success : colors.danger }}>
              {complianceStatus.lodgmentsUpToDate ? "Up to date" : "Overdue"}
            </p>
            <Link to="/bas" style={{ fontSize: fontSizes.sm, color: colors.accent }}>
              View BAS schedule
            </Link>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg, color: colors.textPrimary }}>
              Payments
            </h3>
            <p style={{ margin: 0, color: complianceStatus.paymentsUpToDate ? colors.success : colors.danger }}>
              {complianceStatus.paymentsUpToDate ? "All paid" : "Outstanding"}
            </p>
            <Link to="/activity" style={{ fontSize: fontSizes.sm, color: colors.accent }}>
              Review payment activity
            </Link>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Compliance score</h3>
            <p
              style={{
                margin: 0,
                fontSize: fontSizes.xxl,
                fontWeight: 600,
                color: colors.accentStrong,
              }}
            >
              {complianceStatus.overallCompliance}%
            </p>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Trend: needs attention
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: spacing.lg,
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Key dates</h3>
            <p style={{ margin: 0, color: colors.textSecondary }}>
              Last BAS lodged <strong>{complianceStatus.lastBAS}</strong>
            </p>
            <p style={{ margin: 0, color: colors.textSecondary }}>
              Next BAS due <strong>{complianceStatus.nextDue}</strong>
            </p>
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Outstanding items</h3>
            {complianceStatus.outstandingLodgments.length > 0 && (
              <p style={{ margin: 0, color: colors.danger, fontSize: fontSizes.sm }}>
                Lodgments: {complianceStatus.outstandingLodgments.join(", ")}
              </p>
            )}
            {complianceStatus.outstandingAmounts.length > 0 && (
              <p style={{ margin: 0, color: colors.danger, fontSize: fontSizes.sm }}>
                Payments: {complianceStatus.outstandingAmounts.join(", ")}
              </p>
            )}
          </div>
          <div style={cardStyle}>
            <h3 style={{ margin: 0, fontSize: fontSizes.lg }}>Quick links</h3>
            <ul style={{ margin: 0, paddingLeft: "18px", color: colors.textSecondary, fontSize: fontSizes.sm }}>
              <li>
                <Link to="/evidence" style={{ color: colors.accent }}>
                  Upload supporting evidence
                </Link>
              </li>
              <li>
                <Link to="/wizard" style={{ color: colors.accent }}>
                  Automate PAYGW & GST transfers
                </Link>
              </li>
              <li>
                <Link to="/settings" style={{ color: colors.accent }}>
                  Update business profile
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </Page>
  );
}
