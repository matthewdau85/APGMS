import { NavLink, Outlet } from "react-router-dom";
import CapabilityMatrixPanel from "../components/CapabilityMatrixPanel";
import KillSwitchBanner from "../components/KillSwitchBanner";
import ModePill from "../components/ModePill";

const navigationItems = [
  { label: "Overview", path: "/" },
  { label: "Reports", path: "/reports" },
  { label: "Workflows", path: "/workflows" },
  { label: "Integrations", path: "/integrations" },
  { label: "Settings", path: "/settings" },
];

export default function PageShell() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: "100vh" }}>
      <aside
        style={{
          backgroundColor: "#0f172a",
          color: "#e2e8f0",
          padding: "1.5rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        <div>
          <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>APGMS</div>
          <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>Operations Console</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {navigationItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              style={({ isActive }) => ({
                color: "inherit",
                textDecoration: "none",
                padding: "0.6rem 0.75rem",
                borderRadius: "0.5rem",
                backgroundColor: isActive ? "rgba(148, 163, 184, 0.25)" : "transparent",
                transition: "background-color 0.15s ease",
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <footer style={{ fontSize: "0.75rem", opacity: 0.6 }}>
          &copy; {new Date().getFullYear()} APGMS Platform
        </footer>
      </aside>

      <main style={{ backgroundColor: "#f8fafc", padding: "2rem 2.5rem" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Console Overview</h1>
            <p style={{ margin: 0, color: "#475569" }}>
              Real-time visibility across platform health, workflows, and integrations.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <ModePill />
            <CapabilityMatrixPanel />
          </div>
        </header>

        <KillSwitchBanner />

        <section
          style={{
            backgroundColor: "white",
            borderRadius: "1rem",
            padding: "1.5rem",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            minHeight: "60vh",
          }}
        >
          <Outlet />
        </section>
      </main>
    </div>
  );
}
