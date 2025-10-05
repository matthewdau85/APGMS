import React, { useContext } from "react";
import { NavLink, Outlet } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";
import { AppContext } from "../context/AppContext";

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

export default function AppLayout() {
  const ctx = useContext(AppContext);
  const ratesLabel = ctx
    ? `${ctx.ratesVersion.name} (eff. ${ctx.ratesVersion.effectiveFrom})`
    : "Rates version unavailable";
  const checksum = ctx?.ratesVersion.checksum;

  return (
    <div>
      <header className="app-header">
        <img src={atoLogo} alt="ATO Logo" />
        <h1>APGMS - Automated PAYGW & GST Management</h1>
        <p>ATO-Compliant Tax Management System</p>
        <div className="text-sm" style={{ marginTop: 8 }}>
          <strong>Rates version:</strong> {ratesLabel}
          {checksum ? <span style={{ marginLeft: 8, opacity: 0.8 }}>checksum {checksum.slice(0, 10)}…</span> : null}
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

      <main style={{ padding: 20 }}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>© 2025 APGMS | Compliant with Income Tax Assessment Act 1997 & GST Act 1999</p>
      </footer>
    </div>
  );
}
