import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";
import { fetchJson } from "../utils/api";
import type { RuntimeSummary, ProviderBinding, FeatureFlag } from "../types/runtime";

const navLinks = [
  { to: "/", label: "Dashboard" },
  { to: "/bas", label: "BAS" },
  { to: "/settings", label: "Settings" },
  { to: "/wizard", label: "Wizard" },
  { to: "/audit", label: "Audit" },
  { to: "/fraud", label: "Fraud" },
  { to: "/integrations", label: "Integrations" },
  { to: "/help", label: "Help" },
];

function formatAgo(iso?: string | null) {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1_000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

const modeColors: Record<string, string> = {
  Mock: "#6b7280",
  Shadow: "#2563eb",
  Real: "#16a34a",
};

function ProviderBadge({ provider }: { provider: ProviderBinding }) {
  return (
    <div className="provider-chip">
      <div className="provider-main">
        <span className="provider-label">{provider.label}</span>
        <span className="provider-vendor">{provider.vendor}</span>
      </div>
      <div className="provider-meta">
        <span
          className="provider-mode"
          style={{ background: `${modeColors[provider.mode] || "#374151"}15`, color: modeColors[provider.mode] || "#374151" }}
        >
          {provider.mode}
        </span>
        <span className="provider-status">{provider.status}</span>
        <span className="provider-sync">Last sync {formatAgo(provider.lastSyncIso)}</span>
      </div>
    </div>
  );
}

function FlagBadge({ flag }: { flag: FeatureFlag }) {
  return (
    <div className="flag-chip">
      <span
        className="flag-state"
        style={{ background: flag.enabled ? "#bbf7d0" : "#fee2e2", color: flag.enabled ? "#166534" : "#991b1b" }}
      >
        {flag.enabled ? "Enabled" : "Disabled"}
      </span>
      <div className="flag-details">
        <span className="flag-label">{flag.label}</span>
        {flag.description ? <span className="flag-desc">{flag.description}</span> : null}
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [runtime, setRuntime] = React.useState<RuntimeSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await fetchJson<RuntimeSummary>("/runtime/summary");
        if (mounted) {
          setRuntime(data);
          setError(null);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err?.message || "Unable to load runtime summary");
        }
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const badge = runtime?.badge ?? "Mock";
  const badgeColor = modeColors[badge] || "#4b5563";
  const rates = runtime?.rates;

  return (
    <div>
      <header className="app-header">
        <div className="header-main">
          <img src={atoLogo} alt="ATO Logo" />
          <div>
            <h1>APGMS - Automated PAYGW & GST Management</h1>
            <p>ATO-Compliant Tax Management System</p>
            {rates ? (
              <p className="rates-line">
                Rates pinned → PAYGW {rates.paygw} • GST {rates.gst}
              </p>
            ) : null}
          </div>
          <span
            className="env-badge"
            style={{ background: `${badgeColor}22`, color: badgeColor, border: `1px solid ${badgeColor}55` }}
          >
            {badge} Mode
          </span>
        </div>
        <div className="header-runtime">
          <div className="providers-block">
            <h3>Provider Bindings</h3>
            {runtime?.providers.map((provider) => (
              <ProviderBadge key={provider.id} provider={provider} />
            ))}
          </div>
          <div className="flags-block">
            <h3>Feature Flags</h3>
            {runtime?.feature_flags.map((flag) => (
              <FlagBadge key={flag.key} flag={flag} />
            ))}
            {error ? <div className="runtime-error">{error}</div> : null}
          </div>
        </div>
        <nav style={{ marginTop: 16 }}>
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
              style={{
                margin: "0 18px",
                textDecoration: "none",
                color: "#fff",
                fontWeight: 500,
                fontSize: 16,
                borderBottom: "2px solid transparent",
                paddingBottom: 3,
              }}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* 👇 This tells React Router where to render the child pages */}
      <main style={{ padding: 20 }}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>© 2025 APGMS | Compliant with Income Tax Assessment Act 1997 & GST Act 1999</p>
      </footer>
    </div>
  );
}
