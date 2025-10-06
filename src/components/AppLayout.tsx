import React, { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";
import HelpCenter from "../help/HelpCenter";
import { HelpContextProvider } from "../help/HelpContext";

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

function AppLayoutShell() {
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const handleHotkey = (event: KeyboardEvent) => {
      const isShiftSlash = event.shiftKey && event.code === "Slash";
      if (event.key === "?" || isShiftSlash) {
        const tagName = (event.target as HTMLElement)?.tagName;
        if (tagName && ["INPUT", "TEXTAREA"].includes(tagName)) {
          return;
        }
        event.preventDefault();
        setHelpOpen(true);
      }
    };

    window.addEventListener("keydown", handleHotkey);
    return () => window.removeEventListener("keydown", handleHotkey);
  }, []);

  return (
    <div>
      <header className="app-header">
        <img src={atoLogo} alt="ATO Logo" />
        <h1>APGMS - Automated PAYGW & GST Management</h1>
        <p>ATO-Compliant Tax Management System</p>
        <nav
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
              style={{
                margin: "0 12px",
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
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            style={{
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Help
            <span
              style={{
                background: "rgba(255,255,255,0.18)",
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 12,
              }}
            >
              ⇧ + /
            </span>
          </button>
        </nav>
      </header>

      <main style={{ padding: 20 }}>
        <Outlet />
      </main>

      <footer className="app-footer">
        <p>© 2025 APGMS | Compliant with Income Tax Assessment Act 1997 & GST Act 1999</p>
      </footer>

      <HelpCenter isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

export default function AppLayout() {
  return (
    <HelpContextProvider>
      <AppLayoutShell />
    </HelpContextProvider>
  );
}
