import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { HelpProvider, useHelp } from "./help";
import { colors, fontSizes, radii, shadows, spacing } from "./tokens.css";

const primaryNav = [
  { to: "/", label: "Dashboard" },
  { to: "/bas", label: "BAS" },
  { to: "/evidence", label: "Evidence" },
  { to: "/activity", label: "Activity" },
  { to: "/settings", label: "Settings" },
];

function ShellLayout() {
  const { meta, open, isOpen, close } = useHelp();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: colors.background,
        color: colors.textPrimary,
      }}
    >
      <header
        style={{
          borderBottom: `1px solid ${colors.borderStrong}`,
          background: colors.surface,
          boxShadow: shadows.soft,
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <div
          style={{
            background: colors.accent,
            color: colors.surface,
            padding: `${spacing.xs} ${spacing.xl}`,
            fontSize: fontSizes.sm,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Production workspace</span>
          <span style={{ opacity: 0.8 }}>ATO-aligned controls enabled</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${spacing.lg} ${spacing.xl}`,
            gap: spacing.xl,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: fontSizes.xl,
                color: colors.accentStrong,
              }}
            >
              APGMS Console
            </h1>
            <p
              style={{
                margin: `${spacing.xs} 0 0`,
                color: colors.textSecondary,
                fontSize: fontSizes.sm,
              }}
            >
              Automated PAYGW & GST management across compliance, evidence and activity.
            </p>
          </div>
          <button
            type="button"
            onClick={open}
            disabled={!meta}
            style={{
              padding: `${spacing.sm} ${spacing.lg}`,
              background: meta ? colors.accent : colors.surfaceMuted,
              color: meta ? colors.surface : colors.textMuted,
              border: "none",
              borderRadius: radii.md,
              fontWeight: 600,
              cursor: meta ? "pointer" : "not-allowed",
              transition: "background 0.2s ease",
            }}
          >
            {meta ? `Open help for ${meta.title}` : "Help unavailable"}
          </button>
        </div>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: spacing.xl,
          padding: spacing.xl,
        }}
      >
        <aside
          style={{
            background: colors.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            boxShadow: shadows.soft,
            display: "flex",
            flexDirection: "column",
            gap: spacing.sm,
            position: "sticky",
            top: `calc(${spacing.xl} + 80px)`,
            alignSelf: "start",
          }}
        >
          <span
            style={{
              fontSize: fontSizes.sm,
              fontWeight: 600,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Navigation
          </span>
          {primaryNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                textDecoration: "none",
                padding: `${spacing.sm} ${spacing.md}`,
                borderRadius: radii.md,
                fontWeight: 600,
                fontSize: fontSizes.sm,
                color: isActive ? colors.surface : colors.textSecondary,
                background: isActive ? colors.accent : "transparent",
                border: `1px solid ${isActive ? colors.accent : "transparent"}`,
                transition: "background 0.2s ease, color 0.2s ease",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </aside>
        <main
          style={{
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: spacing.xl,
            paddingBottom: spacing.xl,
          }}
        >
          <Outlet />
        </main>
      </div>

      <footer
        style={{
          padding: `${spacing.md} ${spacing.xl}`,
          borderTop: `1px solid ${colors.borderStrong}`,
          background: colors.surface,
          fontSize: fontSizes.sm,
          color: colors.textMuted,
        }}
      >
        © {new Date().getFullYear()} APGMS. ATO-aligned PAYGW & GST compliance automation.
      </footer>

      {isOpen && meta && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            right: spacing.xl,
            bottom: spacing.xl,
            width: "360px",
            background: colors.surface,
            borderRadius: radii.lg,
            boxShadow: shadows.soft,
            padding: spacing.lg,
            border: `1px solid ${colors.borderStrong}`,
            display: "flex",
            flexDirection: "column",
            gap: spacing.md,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: spacing.sm,
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: fontSizes.sm,
                  color: colors.textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Contextual help
              </p>
              <h2
                style={{
                  margin: `${spacing.xs} 0 0`,
                  fontSize: fontSizes.lg,
                  color: colors.textPrimary,
                }}
              >
                {meta.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              style={{
                border: "none",
                background: "transparent",
                color: colors.textMuted,
                fontSize: fontSizes.lg,
                cursor: "pointer",
              }}
              aria-label="Close help"
            >
              ×
            </button>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: fontSizes.sm,
              color: colors.textSecondary,
              lineHeight: 1.5,
            }}
          >
            Review the {meta.title.toLowerCase()} guide in the knowledge base to understand workflows, required evidence and remediation actions.
          </p>
          <a
            href={`/help/${meta.helpSlug}`}
            style={{
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: spacing.sm,
              fontWeight: 600,
              fontSize: fontSizes.sm,
              color: colors.accent,
            }}
          >
            Go to help article
          </a>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  return (
    <HelpProvider>
      <ShellLayout />
    </HelpProvider>
  );
}
