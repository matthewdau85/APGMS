import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";

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

const runtimeEnv: Record<string, string | undefined> = (() => {
  const meta =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> })
      : undefined;
  if (meta?.env) {
    return meta.env;
  }
  if (typeof process !== "undefined" && process?.env) {
    return process.env as Record<string, string | undefined>;
  }
  if (typeof window !== "undefined") {
    return (
      (window as unknown as { __APP_ENV__?: Record<string, string | undefined> }).__APP_ENV__ ??
      {}
    );
  }
  return {};
})();

const normalize = (value: string | undefined) => (value ?? "").toLowerCase();
const isTruthy = (value: string | undefined) => {
  const normalized = normalize(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

const appMode = normalize(runtimeEnv.VITE_APP_MODE ?? runtimeEnv.APP_MODE);
const dspOk = isTruthy(runtimeEnv.VITE_DSP_OK ?? runtimeEnv.DSP_OK);
const showPrototypeBanner = !(appMode === "real" && dspOk);

export default function AppLayout() {
  return (
    <div>
      <header className="app-header">
        <img src={atoLogo} alt="ATO Logo" />
        <h1>APGMS - Automated PAYGW & GST Management</h1>
        <p>Operational prototype under DSP accreditation review.</p>
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

      {showPrototypeBanner && (
        <div className="prototype-banner" role="status">
          Prototype only – controls in validation. Confirm obligations with the ATO before acting.
        </div>
      )}

      <main style={{ padding: 20 }}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>© 2025 APGMS | Prototype platform – DSP alignment in progress.</p>
      </footer>
    </div>
  );
}
