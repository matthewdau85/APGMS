import { clsx } from "clsx";
import { FeatureGate } from "../constants/featureGates";
import type { FeatureGateState } from "../api/schema";

interface ModePillProps {
  gates?: FeatureGateState[];
}

function resolveMode(gates?: FeatureGateState[]): { label: string; tone: "live" | "shadow" | "override" } {
  const enabled = new Map<FeatureGate, boolean>();
  gates?.forEach((gate) => enabled.set(gate.gate, gate.enabled));

  if (enabled.get(FeatureGate.ShadowMode)) {
    return { label: "Shadow", tone: "shadow" };
  }

  if (enabled.get(FeatureGate.ProtoAllowOverrides)) {
    return { label: "Override", tone: "override" };
  }

  return { label: "Live", tone: "live" };
}

export function ModePill({ gates }: ModePillProps) {
  const mode = resolveMode(gates);
  return (
    <span
      data-testid="mode-pill"
      className={clsx(
        "inline-flex items-center gap-2 rounded-full px-4 py-1 text-sm font-medium",
        {
          "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/40": mode.tone === "live",
          "bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/40": mode.tone === "shadow",
          "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/40": mode.tone === "override",
        }
      )}
    >
      <span className="size-2 rounded-full bg-current" aria-hidden />
      <span className="uppercase tracking-wide">{mode.label} Mode</span>
    </span>
  );
}
