import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { queryClient } from "./api/client";
import PageShell from "./layouts/PageShell";

function Dashboard() {
  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <section>
        <h2 style={{ marginBottom: "0.25rem" }}>Status Tiles</h2>
        <p style={{ margin: 0, color: "#475569" }}>
          Live system status cards will be placed here, summarising the posture of APGMS
          services.
        </p>
      </section>
      <section>
        <h2 style={{ marginBottom: "0.25rem" }}>Upcoming Work</h2>
        <p style={{ margin: 0, color: "#475569" }}>
          Planned releases, automation runs, and RPT widgets mount within this workspace.
        </p>
      </section>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PageShell />}>
            <Route index element={<Dashboard />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
