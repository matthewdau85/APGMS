import { createRoot } from "react-dom/client";
import { WithQuery } from "./ui/query";
import { ModeBanner } from "./ui/ModeBanner";
import { Dashboard } from "./dashboard/Dashboard";

type ConsoleEnv = {
  mode: string;
  abn: string;
  periodId: string;
};

function resolveEnv(): ConsoleEnv {
  const mode = (import.meta.env.VITE_CONSOLE_MODE || "prototype").toString();
  const abn = (import.meta.env.VITE_CONSOLE_ABN || "12345678901").toString();
  const periodId = (import.meta.env.VITE_CONSOLE_PERIOD_ID || "2025-10").toString();
  return { mode: mode.toLowerCase(), abn, periodId };
}

function App() {
  const { mode, abn, periodId } = resolveEnv();

  return (
    <WithQuery>
      <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
        <ModeBanner mode={mode} />
        <Dashboard abn={abn} periodId={periodId} mode={mode} />
      </div>
    </WithQuery>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(<App />);
