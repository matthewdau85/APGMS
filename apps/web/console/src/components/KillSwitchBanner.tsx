interface KillSwitchBannerProps {
  active: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export function KillSwitchBanner({ active, updatedAt, updatedBy }: KillSwitchBannerProps) {
  if (!active) return null;

  return (
    <div className="bg-red-600/20 border border-red-500/40 rounded-lg px-4 py-3 text-sm text-red-200">
      <div className="font-semibold uppercase tracking-wide">Kill Switch Active</div>
      <p className="mt-1 text-red-100/80">
        RPT issuance and queue processing are suspended. Override gates must be cleared before
        resuming operations.
      </p>
      {(updatedAt || updatedBy) && (
        <p className="mt-2 text-xs text-red-100/60">
          {updatedBy ? `Last toggled by ${updatedBy}` : "Kill switch updated"}
          {updatedAt ? ` on ${new Date(updatedAt).toLocaleString()}` : ""}.
        </p>
      )}
    </div>
  );
}
