import { clsx } from "clsx";
import type { MouseEventHandler } from "react";

interface IssueRptButtonProps {
  disabled: boolean;
  disabledReason?: string;
  onIssue: MouseEventHandler<HTMLButtonElement>;
  isSubmitting: boolean;
}

export function IssueRptButton({ disabled, disabledReason, onIssue, isSubmitting }: IssueRptButtonProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onIssue}
        disabled={disabled || isSubmitting}
        className={clsx(
          "inline-flex items-center justify-center rounded-lg px-5 py-2 text-sm font-semibold transition",
          "bg-brand-primary/20 text-sky-100 ring-1 ring-brand-primary/40 hover:bg-brand-primary/30",
          "disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 disabled:ring-slate-700"
        )}
      >
        {isSubmitting ? "Issuing…" : "Issue RPT"}
      </button>
      {(disabled || isSubmitting) && disabledReason && (
        <p className="text-xs text-slate-400" data-testid="issue-rpt-disabled-reason">
          {disabledReason}
        </p>
      )}
    </div>
  );
}
