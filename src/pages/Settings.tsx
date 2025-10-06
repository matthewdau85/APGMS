import React, { useState } from "react";
import Page from "../ui/Page";
import { colors, fontSizes, radii, shadows, spacing } from "../ui/tokens.css";

export const meta = {
  title: "Workspace settings",
  helpSlug: "settings",
};

const tabs = [
  { id: "profile", label: "Business profile" },
  { id: "accounts", label: "Accounts" },
  { id: "automation", label: "Automation" },
  { id: "notifications", label: "Notifications" },
];

const panelStyle: React.CSSProperties = {
  background: colors.surface,
  borderRadius: radii.lg,
  boxShadow: shadows.soft,
  padding: spacing.xl,
  display: "flex",
  flexDirection: "column",
  gap: spacing.md,
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com",
  });

  const renderTab = () => {
    switch (activeTab) {
      case "profile":
        return (
          <div style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Business profile</h2>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Update the identifiers used for PAYGW & GST reporting. These details surface across the dashboard and evidence workspace.
            </p>
            {(
              [
                { key: "abn", label: "Australian Business Number" },
                { key: "name", label: "Legal name" },
                { key: "trading", label: "Trading name" },
                { key: "contact", label: "Contact email or phone" },
              ] as const
            ).map((field) => (
              <label key={field.key} style={{ display: "flex", flexDirection: "column", gap: spacing.xs, fontSize: fontSizes.sm }}>
                <span style={{ fontWeight: 600 }}>{field.label}</span>
                <input
                  value={profile[field.key]}
                  onChange={(event) =>
                    setProfile((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  style={{
                    padding: `${spacing.sm} ${spacing.md}`,
                    borderRadius: radii.md,
                    border: `1px solid ${colors.border}`,
                    fontSize: fontSizes.sm,
                  }}
                />
              </label>
            ))}
          </div>
        );
      case "accounts":
        return (
          <div style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Linked accounts</h2>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Maintain the operating, PAYGW buffer and GST saver accounts used by automation rules.
            </p>
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
                  {["Account", "BSB", "Number", "Type"].map((heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: "left",
                        padding: `${spacing.sm} ${spacing.md}`,
                        borderBottom: `1px solid ${colors.border}`,
                        fontWeight: 600,
                        color: colors.textPrimary,
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { name: "Main business", bsb: "123-456", number: "11111111", type: "Operating" },
                  { name: "PAYGW saver", bsb: "123-456", number: "22222222", type: "PAYGW buffer" },
                ].map((account) => (
                  <tr key={account.number}>
                    {[account.name, account.bsb, account.number, account.type].map((value) => (
                      <td
                        key={value}
                        style={{
                          padding: `${spacing.sm} ${spacing.md}`,
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              style={{
                alignSelf: "flex-start",
                padding: `${spacing.sm} ${spacing.lg}`,
                borderRadius: radii.md,
                border: `1px solid ${colors.accent}`,
                background: "transparent",
                color: colors.accent,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Link another account
            </button>
          </div>
        );
      case "automation":
        return (
          <div style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Automation rules</h2>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Configure scheduled transfers and notifications to keep PAYGW & GST obligations in sync.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: spacing.sm,
                fontSize: fontSizes.sm,
                color: colors.textSecondary,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                <input type="checkbox" defaultChecked /> Weekly PAYGW sweep (Friday)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                <input type="checkbox" /> Monthly GST top-up (Day 21)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
                <input type="checkbox" defaultChecked /> Notify if balance drifts under forecast
              </label>
            </div>
          </div>
        );
      case "notifications":
        return (
          <div style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: fontSizes.lg }}>Notifications</h2>
            <p style={{ margin: 0, color: colors.textSecondary, fontSize: fontSizes.sm }}>
              Stay informed about due dates, evidence gaps and activity feed items.
            </p>
            <div
              style={{
                display: "grid",
                gap: spacing.sm,
                fontSize: fontSizes.sm,
                color: colors.textSecondary,
              }}
            >
              <label style={{ display: "flex", gap: spacing.sm }}>
                <input type="checkbox" defaultChecked /> Email reminder for BAS lodgment
              </label>
              <label style={{ display: "flex", gap: spacing.sm }}>
                <input type="checkbox" /> SMS alert for large transfers
              </label>
              <label style={{ display: "flex", gap: spacing.sm }}>
                <input type="checkbox" defaultChecked /> Weekly compliance digest
              </label>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <Page
      meta={meta}
      breadcrumbs={[{ label: "Workspace" }, { label: "Settings" }]}
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
          Save changes
        </button>
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.lg,
        }}
      >
        <div
          role="tablist"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: spacing.sm,
            background: colors.surface,
            borderRadius: radii.lg,
            boxShadow: shadows.soft,
            padding: spacing.sm,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: `${spacing.sm} ${spacing.lg}`,
                borderRadius: radii.md,
                border: `1px solid ${activeTab === tab.id ? colors.accent : "transparent"}`,
                background: activeTab === tab.id ? colors.accent : "transparent",
                color: activeTab === tab.id ? colors.surface : colors.textSecondary,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {renderTab()}
      </div>
    </Page>
  );
}
