import React, { useId, useState } from "react";

import type { QueueItem } from "../App";
import { IssueRptButton } from "./buttons/IssueRptButton";

interface QueueTableRowProps {
  item: QueueItem;
  killSwitchActive: boolean;
}

export function QueueTableRow({ item, killSwitchActive }: QueueTableRowProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const drawerId = useId();

  const killSwitchReason = killSwitchActive
    ? "Kill switch active: Issue RPT actions are temporarily disabled."
    : undefined;

  const disabledReason = killSwitchReason ?? item.issueRptDisabledReason;

  return (
    <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-testid={`${item.id}-card`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={drawerId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <div>
          <p className="text-base font-semibold text-slate-900">{item.label}</p>
          <p className="text-sm text-slate-500">{item.summary}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">
            {item.pendingCount} pending
          </span>
          <span className="text-slate-500">{open ? "Hide details" : "View details"}</span>
        </div>
      </button>
      {open ? (
        <div id={drawerId} role="region" aria-live="polite" className="border-t border-slate-200 bg-slate-50 px-4 py-4" data-testid={`${item.id}-drawer`}>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            {item.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
          <IssueRptButton
            queueId={item.id}
            queueLabel={item.label}
            disabledReason={disabledReason}
          />
        </div>
      ) : null}
    </article>
  );
}
