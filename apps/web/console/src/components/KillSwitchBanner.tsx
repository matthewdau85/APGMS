import React from "react";

interface KillSwitchBannerProps {
  active: boolean;
}

export function KillSwitchBanner({ active }: KillSwitchBannerProps): React.ReactElement | null {
  if (!active) {
    return null;
  }

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 shadow-sm"
      data-testid="kill-switch-banner"
    >
      <p className="font-semibold">Kill switch active</p>
      <p className="text-sm">
        All automated lodgments are paused. Manual review is required before issuing new RPTs.
      </p>
    </div>
  );
}
