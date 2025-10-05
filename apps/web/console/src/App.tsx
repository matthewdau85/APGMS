import React, { useMemo, useState } from "react";

import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { ModePill } from "./components/ModePill";
import { QueueTable } from "./components/QueueTable";

type ConsoleMode = "AUTO" | "MANUAL";

type QueueItem = {
  id: string;
  label: string;
  pendingCount: number;
  summary: string;
  details: string[];
  issueRptDisabledReason?: string;
};

const INITIAL_QUEUE: QueueItem[] = [
  {
    id: "queue-paygw",
    label: "PAYGW Lodgments",
    pendingCount: 3,
    summary: "PAYGW settlements ready for overnight batching.",
    details: [
      "3 payments reconciled against the PAYGW holding account.",
      "ATO settlement window opens at 18:00 AEST.",
    ],
  },
  {
    id: "queue-gst",
    label: "GST Adjustments",
    pendingCount: 1,
    summary: "Manual override required before issuing an RPT.",
    details: [
      "Adjustment flagged by compliance rules.",
      "CFO approval pending for variance greater than 10%.",
    ],
    issueRptDisabledReason: "Awaiting CFO approval before issuing the RPT.",
  },
];

export function App(): React.ReactElement {
  const [mode, setMode] = useState<ConsoleMode>("AUTO");
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  const queueItems = useMemo(() => INITIAL_QUEUE, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              APGMS Console
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">Realtime lodgment oversight</h1>
          </div>
          <div className="flex items-center gap-3">
            <ModePill
              mode={mode}
              onToggle={() => setMode((current) => (current === "AUTO" ? "MANUAL" : "AUTO"))}
            />
            <button
              type="button"
              role="switch"
              aria-checked={killSwitchActive}
              aria-label={`Kill switch is ${killSwitchActive ? "active" : "inactive"}. Toggle kill switch.`}
              onClick={() => setKillSwitchActive((value) => !value)}
              className="flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50"
            >
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden="true" />
              Kill switch
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <KillSwitchBanner active={killSwitchActive} />
        <QueueTable killSwitchActive={killSwitchActive} items={queueItems} />
      </main>
    </div>
  );
}

export type { QueueItem, ConsoleMode };
