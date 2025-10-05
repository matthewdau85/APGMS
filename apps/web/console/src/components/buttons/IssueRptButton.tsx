import React from "react";

interface IssueRptButtonProps {
  queueId: string;
  queueLabel: string;
  disabledReason?: string;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function IssueRptButton({ queueId, queueLabel, disabledReason }: IssueRptButtonProps): React.ReactElement {
  const reasonId = disabledReason ? `${slugify(queueId)}-issue-rpt-reason` : undefined;

  return (
    <div className="space-y-2" data-testid={`${queueId}-issue-rpt`}>
      <button
        type="button"
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-200 disabled:text-emerald-700"
        aria-label={`Issue RPT for ${queueLabel}`}
        aria-describedby={reasonId}
        disabled={Boolean(disabledReason)}
      >
        Issue RPT
      </button>
      {disabledReason ? (
        <p id={reasonId} role="note" className="text-sm text-emerald-900">
          {disabledReason}
        </p>
      ) : null}
    </div>
  );
}
