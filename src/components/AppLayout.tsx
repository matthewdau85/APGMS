import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";
import HelpCenter from "./HelpCenter";
import WhatsNewPanel from "./WhatsNewPanel";
import { useSupport } from "../context/SupportContext";
import { getRuntimeBanner } from "../utils/runtime";

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
  const { openHelpCenter, openWhatsNew } = useSupport();
  const banner = getRuntimeBanner();

  return (
    <div>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-branding">
            <img src={atoLogo} alt="ATO Logo" />
            <div>
              <h1>APGMS - Automated PAYGW & GST Management</h1>
              <p>ATO-Compliant Tax Management System</p>
            </div>
          </div>
          <div className="app-header-actions">
            <button type="button" className="header-button" onClick={openWhatsNew}>
              What&apos;s New
            </button>
            <button type="button" className="header-button" onClick={() => openHelpCenter()}>
              Help Center · Shift + /
            </button>
          </div>
        </div>
        <nav className="app-nav">
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

      <div className="mode-banner" role="status" aria-live="polite">
        <span className="mode-pill">{banner.modeLabel}</span>
        <span className="mode-separator">•</span>
        <span className="mode-rails">Rails: {banner.railsLabel}</span>
      </div>

      {/* 👇 This tells React Router where to render the child pages */}
      <main style={{ padding: 20 }}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>© 2025 APGMS | Compliant with Income Tax Assessment Act 1997 & GST Act 1999</p>
      </footer>

      <HelpCenter />
      <WhatsNewPanel />
    </div>
  );
}
