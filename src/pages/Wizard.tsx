import React, { useMemo, useState } from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Setup wizard",
  helpSlug: "wizard",
};

const steps = [
  { id: "business", label: "Business details" },
  { id: "accounts", label: "Link accounts" },
  { id: "payroll", label: "Payroll provider" },
  { id: "automation", label: "Automation" },
  { id: "review", label: "Review & complete" },
] as const;

const panelStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radii.lg,
  boxShadow: shadows.soft,
  padding: spacing.xl,
  display: "flex",
  flexDirection: "column",
  gap: spacing.md,
};

export default function Wizard() {
  const [active, setActive] = useState(0);
  const step = useMemo(() => steps[active], [active]);

  return (
    <Page
      meta={meta}
      breadcrumbs={[{ label: "Workspace" }, { label: "Setup wizard" }]}
      actions={
        <div style={{ display: "flex", gap: spacing.sm }}>
          {active > 0 && (
            <button
              type="button"
              onClick={() => setActive((value) => Math.max(0, value - 1))}
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
              Back
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setActive((value) => Math.min(steps.length - 1, value + 1))
            }
            style={{
              padding: `${spacing.sm} ${spacing.lg}`,
              borderRadius: radii.md,
              border: "none",
              background: active === steps.length - 1 ? colors.success : colors.accent,
              color: colors.surface,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {active === steps.length - 1 ? "Finish" : "Next"}
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: spacing.xl }}>
        <div
          style={{
            background: colors.surface,
            borderRadius: radii.lg,
            boxShadow: shadows.soft,
            padding: spacing.sm,
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.sm,
          }}
        >
          {steps.map((item, index) => (
            <div
              key={item.id}
              style={{
                flex: "1 1 140px",
                minWidth: "140px",
                borderRadius: radii.md,
                border: `1px solid ${index === active ? colors.accent : colors.border}`,
                background: index === active ? colors.accent : colors.surface,
                color: index === active ? colors.surface : colors.textSecondary,
                padding: `${spacing.sm} ${spacing.md}`,
                fontWeight: 600,
                textTransform: "capitalize",
                textAlign: "center",
              }}
            >
              Step {index + 1}: {item.label}
            </div>
          ))}
        </div>

        <div style={panelStyle}>
          {step.id === "business" && (
            <>
              <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Business details</h2>
              <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs, fontSize: fontSizes.sm }}>
                <span style={{ fontWeight: 600 }}>Business ABN</span>
                <input
                  defaultValue="12 345 678 901"
                  style={{
                    padding: `${spacing.sm} ${spacing.md}`,
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    fontSize: fontSizes.sm,
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs, fontSize: fontSizes.sm }}>
                <span style={{ fontWeight: 600 }}>Legal name</span>
                <input
                  defaultValue="Example Pty Ltd"
                  style={{
                    padding: `${spacing.sm} ${spacing.md}`,
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    fontSize: fontSizes.sm,
                  }}
                />
              </label>
            </>
          )}
          {step.id === "accounts" && (
            <>
              <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Link accounts</h2>
              <div style={{ display: "grid", gap: spacing.sm, fontSize: fontSizes.sm }}>
                <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                  <span style={{ fontWeight: 600 }}>BSB</span>
                  <input
                    defaultValue="123-456"
                    style={{
                      padding: `${spacing.sm} ${spacing.md}`,
                      borderRadius: radii.md,
                      border: `1px solid ${colors.border}`,
                    }}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs }}>
                  <span style={{ fontWeight: 600 }}>Account number</span>
                  <input
                    defaultValue="11111111"
                    style={{
                      padding: `${spacing.sm} ${spacing.md}`,
                      borderRadius: radii.md,
                      border: `1px solid ${colors.border}`,
                    }}
                  />
                </label>
              </div>
            </>
          )}
          {step.id === "payroll" && (
            <>
              <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Payroll provider</h2>
              <label style={{ display: "flex", flexDirection: "column", gap: spacing.xs, fontSize: fontSizes.sm }}>
                <span style={{ fontWeight: 600 }}>Select a provider</span>
                <select
                  defaultValue="MYOB"
                  style={{
                    padding: `${spacing.sm} ${spacing.md}`,
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    fontSize: fontSizes.sm,
                  }}
                >
                  <option>MYOB</option>
                  <option>QuickBooks</option>
                </select>
              </label>
            </>
          )}
          {step.id === "automation" && (
            <>
              <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Automation</h2>
              <label style={{ display: "flex", alignItems: "center", gap: spacing.sm, fontSize: fontSizes.sm }}>
                <input type="checkbox" defaultChecked /> Enable weekly PAYGW sweep
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: spacing.sm, fontSize: fontSizes.sm }}>
                <input type="checkbox" /> Notify me if transfer fails
              </label>
            </>
          )}
          {step.id === "review" && (
            <>
              <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Review & complete</h2>
              <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
                Confirm details and finish onboarding. A summary will be emailed and the activity feed updated.
              </p>
            </>
          )}
        </div>
      </div>
    </Page>
  );
}
