import React, { useId } from "react";

export type ModeVariant = "Prototype" | "Real";

const TOOLTIP_COPY: Record<ModeVariant, string> = {
  Prototype:
    "Safe demo mode. Bank calls are simulated; you can explore without moving real money.",
  Real:
    "Live mode with your bank connections, security checks, and real payments.",
};

interface ModeBadgeProps {
  mode?: ModeVariant;
}

export default function ModeBadge({ mode = "Prototype" }: ModeBadgeProps) {
  const tooltipId = useId();
  const tooltip = TOOLTIP_COPY[mode];

  return (
    <div
      className="mode-badge"
      tabIndex={0}
      role="status"
      aria-label={`${mode} mode`}
      aria-describedby={tooltipId}
    >
      <span className="mode-badge__label">{mode}</span>
      <span id={tooltipId} className="mode-badge__tooltip" role="tooltip">
        {tooltip}
      </span>
    </div>
  );
}
