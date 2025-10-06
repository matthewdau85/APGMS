import React from "react";

type EmptyStateProps = {
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
};

type ErrorStateProps = {
  title?: string;
  body?: string;
  requestId: string;
  actionLabel?: string;
  onAction?: () => void;
};

type LoadingStateProps = {
  label: string;
};

const baseCardClass =
  "flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm";

export function EmptyState({ title, body, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <section className={baseCardClass} role="status" aria-live="polite">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <span aria-hidden>🗂️</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600">{body}</p>
      </div>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {ctaLabel}
        </button>
      )}
    </section>
  );
}

export function ErrorState({
  title = "We couldn't load this",
  body = "What you can try next…",
  requestId,
  actionLabel,
  onAction,
}: ErrorStateProps) {
  return (
    <section className={`${baseCardClass} border-red-200 bg-red-50`} role="alert">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
        <span aria-hidden>⚠️</span>
      </div>
      <div>
        <h2 className="text-lg font-semibold text-red-800">{title}</h2>
        <p className="text-sm text-red-700">{body}</p>
        <p className="text-xs font-mono text-red-600">Request ID: {requestId}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <section className={baseCardClass} role="status" aria-live="polite">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <span
          className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
          aria-hidden
        />
      </div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
    </section>
  );
}
