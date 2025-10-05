import { ReactNode, useMemo } from "react";

export interface JsonViewerProps {
  value: unknown;
  title?: string;
  footer?: ReactNode;
  maxHeight?: number;
}

export function JsonViewer({ value, title, footer, maxHeight = 320 }: JsonViewerProps) {
  const formatted = useMemo(() => JSON.stringify(value, null, 2), [value]);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-950/90 text-slate-100">
      {title && <div className="border-b border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wider">{title}</div>}
      <pre
        className="flex-1 overflow-auto px-4 py-3 text-xs leading-relaxed"
        style={{ maxHeight }}
        role="log"
        aria-live="polite"
      >
        {formatted}
      </pre>
      {footer && <div className="border-t border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-400">{footer}</div>}
    </div>
  );
}
