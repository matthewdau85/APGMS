import React from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import atoLogo from "../assets/ato-logo.svg";
import ContextPanel from "../help/ContextPanel";
import { getContextForPath } from "../help/contextMap";

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
  const location = useLocation();
  const [isHelpOpen, setIsHelpOpen] = React.useState(false);
  const [isHelpHovered, setIsHelpHovered] = React.useState(false);
  const context = getContextForPath(location.pathname);

  React.useEffect(() => {
    setIsHelpOpen(false);
  }, [location.pathname]);

  const helpButtonStyle: React.CSSProperties = {
    position: "absolute",
    top: 24,
    right: 24,
    width: 40,
    height: 40,
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.7)",
    backgroundColor: isHelpHovered
      ? "rgba(30, 64, 175, 0.6)"
      : "rgba(15, 23, 42, 0.4)",
    color: "#fff",
    fontSize: 22,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.2s ease, transform 0.2s ease",
    transform: isHelpHovered ? "translateY(-1px)" : "none",
  };

  return (
    <div>
      <header
        className="app-header"
        style={{ position: "relative", paddingRight: 72 }}
      >
        <img src={atoLogo} alt="ATO Logo" />
        <h1>APGMS - Automated PAYGW & GST Management</h1>
        <p>ATO-Compliant Tax Management System</p>
        {context && (
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            onMouseEnter={() => setIsHelpHovered(true)}
            onMouseLeave={() => setIsHelpHovered(false)}
            aria-label="Open page help"
            style={helpButtonStyle}
          >
            ?
          </button>
        )}
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

      {context && isHelpOpen && (
        <ContextPanel
          title={context.title}
          description={context.description}
          steps={context.steps}
          links={context.links}
          onClose={() => setIsHelpOpen(false)}
        />
      )}
    </div>
  );
}
