"use client";

import { FormEvent, useState } from "react";
import type { QueueItem } from "../app/data/queues";

interface ActionPanelProps {
  item: QueueItem | null;
  overridesEnabled: boolean;
}

interface ActionLog {
  timestamp: number;
  message: string;
}

export function ActionPanel({ item, overridesEnabled }: ActionPanelProps) {
  const [reason, setReason] = useState("");
  const [approver, setApprover] = useState("");
  const [actionLog, setActionLog] = useState<ActionLog[]>([]);

  if (!item) {
    return (
      <aside className="rounded-lg border border-dashed border-slate-200 bg-white/40 p-4 text-sm text-slate-500">
        Select an item to view available actions.
      </aside>
    );
  }

  const disabledMessage = overridesEnabled
    ? undefined
    : "Actions are locked. Set PROTO_ALLOW_OVERRIDES=true to enable.";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!overridesEnabled) {
      return;
    }
    const logEntry: ActionLog = {
      timestamp: Date.now(),
      message: `Override documented for ${item.id} by ${approver} with reason: ${reason}`,
    };
    setActionLog((current) => [logEntry, ...current].slice(0, 5));
    setReason("");
    setApprover("");
  };

  const formValid = overridesEnabled && reason.trim().length > 6 && approver.trim().length > 1;

  return (
    <aside className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="actions-heading">
      <h3 id="actions-heading" className="text-base font-semibold text-slate-900">
        Actions
      </h3>
      <p className="mt-1 text-sm text-slate-600">
        Documented action trail for <span className="font-medium">{item.subject}</span>.
      </p>
      <form className="mt-4 space-y-4" onSubmit={handleSubmit} aria-describedby={disabledMessage ? "override-disabled" : undefined}>
        {!overridesEnabled ? (
          <p id="override-disabled" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            Actions require PROTO_ALLOW_OVERRIDES=true. Provide overrides in a controlled environment.
          </p>
        ) : (
          <p className="rounded-md border border-brand-primary/40 bg-brand-primary/10 p-3 text-sm text-brand-primary">
            Overrides enabled. Capture a reason and second approver to continue.
          </p>
        )}
        <div className="space-y-1">
          <label htmlFor="action-reason" className="block text-sm font-medium text-slate-700">
            Reason for action
          </label>
          <textarea
            id="action-reason"
            name="action-reason"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-accent"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={!overridesEnabled}
            required={overridesEnabled}
            aria-required={overridesEnabled}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="action-approver" className="block text-sm font-medium text-slate-700">
            Second approver
          </label>
          <input
            id="action-approver"
            name="action-approver"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-accent"
            value={approver}
            onChange={(event) => setApprover(event.target.value)}
            disabled={!overridesEnabled}
            required={overridesEnabled}
            aria-required={overridesEnabled}
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!formValid}
        >
          Log action
        </button>
      </form>
      {actionLog.length > 0 && (
        <section className="mt-4" aria-live="polite">
          <h4 className="text-sm font-semibold text-slate-800">Recent overrides</h4>
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            {actionLog.map((entry) => (
              <li key={entry.timestamp} className="rounded-md bg-slate-50 p-2">
                <span className="block text-xs text-slate-500">
                  {new Date(entry.timestamp).toLocaleString()}
                </span>
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
