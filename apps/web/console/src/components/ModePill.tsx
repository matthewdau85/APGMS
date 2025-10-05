import React from "react";

import type { ConsoleMode } from "../App";

interface ModePillProps {
  mode: ConsoleMode;
  onToggle: () => void;
}

export function ModePill({ mode, onToggle }: ModePillProps): React.ReactElement {
  const isAuto = mode === "AUTO";
  const label = isAuto ? "Auto" : "Manual";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isAuto}
      aria-label={`Console mode is ${label.toLowerCase()}. Toggle mode.`}
      onClick={onToggle}
      data-testid="mode-pill"
      className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-900 px-4 py-2 text-slate-100 shadow-sm transition-colors hover:bg-slate-800"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">Mode</span>
      <span className="text-sm font-medium" data-testid="mode-pill-label">
        {label}
      </span>
    </button>
  );
}
