import { useQuery } from "@tanstack/react-query";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { AuditPage, BasPage, DashboardPage, QueuesPage, RptsPage, SettingsPage } from "./pages";

const navigation = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "BAS", to: "/bas" },
  { label: "RPTs", to: "/rpts" },
  { label: "Queues", to: "/queues" },
  { label: "Audit", to: "/audit" },
  { label: "Settings", to: "/settings" },
];

export default function App() {
  const { data: basStatus } = useQuery({
    queryKey: ["bas-status"],
    queryFn: () => api.getBasStatus(),
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg">
        Skip to content
      </a>
      <div className="flex">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white/90 backdrop-blur sm:block">
          <div className="border-b border-slate-200 px-6 py-5">
            <span className="text-lg font-semibold">APGMS Console</span>
            <p className="text-xs text-slate-500">Operational control plane</p>
          </div>
          <nav className="px-4 py-6" aria-label="Primary">
            <ul className="space-y-1">
              {navigation.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center rounded-md px-3 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring focus-visible:ring-blue-500/60 ${
                        isActive ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="flex-1">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
            <div className="sm:hidden">
              <span className="text-lg font-semibold text-slate-900">APGMS Console</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>Rates pinned</span>
              <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-1 font-semibold text-slate-700">
                {basStatus ? `v${basStatus.pinnedRatesVersion}` : "—"}
              </span>
            </div>
          </header>
          <main id="main" className="px-4 py-6 sm:px-8">
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/bas" element={<BasPage />} />
              <Route path="/rpts" element={<RptsPage />} />
              <Route path="/queues" element={<QueuesPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
      <p className="font-semibold">Page not found</p>
      <p className="mt-2">Select a destination from the navigation to get back on track.</p>
    </div>
  );
}
