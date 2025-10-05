import React from "react";
import { createRoot } from "react-dom/client";

import "./globals.css";

function App() {
  return (
    <div className="min-h-screen bg-bg text-fg antialiased">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-muted-fg">APGMS</p>
          <h1 className="text-4xl font-semibold tracking-tight">Console</h1>
          <p className="max-w-2xl text-lg text-muted-fg">
            Status tiles and RPT widgets will appear here. (P40, P41, P42)
          </p>
        </header>

        <section className="rounded-lg border border-border bg-muted p-6 shadow-sm">
          <h2 className="text-2xl font-semibold">Coming soon</h2>
          <p className="mt-2 max-w-3xl text-muted-fg">
            This surface will light up with live status tiles and reporting widgets as the modules
            land. Hook your feature shells into the shared design tokens defined in <code>src/globals.css</code>
            to keep styling consistent.
          </p>
        </section>
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
