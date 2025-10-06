import React, { useEffect, useMemo, useState } from "react";

type FeatureKey = "SIM_INBOUND" | "SIM_OUTBOUND" | "DRY_RUN" | "SHADOW_ONLY" | "APP_MODE";

type FeatureValue = boolean | string | null;

type FlagState = Record<FeatureKey, FeatureValue>;

type FlagDescriptor = {
  label: string;
  description: string;
  type: "boolean" | "mode";
};

const FLAG_DESCRIPTORS: Record<FeatureKey, FlagDescriptor> = {
  SIM_INBOUND: {
    label: "Inbound simulator",
    description: "Mock inbound feeds from payroll, point-of-sale, and gateways.",
    type: "boolean",
  },
  SIM_OUTBOUND: {
    label: "Outbound simulator",
    description: "Fake disbursements and ATO lodgement responses.",
    type: "boolean",
  },
  DRY_RUN: {
    label: "Dry run",
    description: "Skip irreversible writes but exercise the orchestration graph.",
    type: "boolean",
  },
  SHADOW_ONLY: {
    label: "Shadow-mode",
    description: "Mirror production inputs without touching settlement accounts.",
    type: "boolean",
  },
  APP_MODE: {
    label: "App mode",
    description: "Global behaviour: sandbox, pilot, or real banking.",
    type: "mode",
  },
};

const DEFAULT_FLAGS: FlagState = {
  SIM_INBOUND: true,
  SIM_OUTBOUND: true,
  DRY_RUN: true,
  SHADOW_ONLY: false,
  APP_MODE: "sandbox",
};

type ServerResponse = {
  flags: Partial<FlagState>;
};

function nextRequestId() {
  const cryptoApi = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Modes() {
  const [flags, setFlags] = useState<FlagState>(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<FeatureKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchFlags() {
      try {
        const res = await fetch("/api/admin/feature-flags");
        if (!res.ok) throw new Error(`Failed to load flags (${res.status})`);
        const body: ServerResponse = await res.json();
        if (!cancelled) {
          setFlags({ ...DEFAULT_FLAGS, ...body.flags });
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to fetch flags");
          setLoading(false);
        }
      }
    }
    fetchFlags();
    return () => {
      cancelled = true;
    };
  }, []);

  const headerPreview = useMemo(() => {
    return {
      "X-APGMS-Sim-Inbound": flags.SIM_INBOUND ? "on" : "off",
      "X-APGMS-Sim-Outbound": flags.SIM_OUTBOUND ? "on" : "off",
      "X-APGMS-Dry-Run": flags.DRY_RUN ? "on" : "off",
      "X-APGMS-Shadow": flags.SHADOW_ONLY ? "on" : "off",
      "X-APGMS-Mode": flags.APP_MODE ?? "sandbox",
    };
  }, [flags]);

  async function updateFlag(key: FeatureKey, value: FeatureValue, extras?: Record<string, unknown>) {
    setPendingKey(key);
    setError(null);
    try {
      const requestId = nextRequestId();
      const res = await fetch(`/api/admin/feature-flags/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value, requestId, ...extras }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Failed to update ${key}`);
      }
      const body: ServerResponse = await res.json();
      setFlags(prev => ({ ...prev, ...body.flags }));
    } catch (err: any) {
      setError(err?.message || `Failed to update ${key}`);
    } finally {
      setPendingKey(current => (current === key ? null : current));
    }
  }

  async function toggleBoolean(key: FeatureKey, current: boolean) {
    const next = !current;
    if (key === "APP_MODE") {
      await updateFlag(key, next ? "real" : "sandbox");
      return;
    }
    await updateFlag(key, next);
  }

  async function changeMode(nextMode: string) {
    if (nextMode === "real") {
      const mfaCode = window.prompt("Enter MFA code to continue");
      if (!mfaCode) {
        return;
      }
      const approver = window.prompt("Second approver (email or ID)");
      if (!approver) {
        return;
      }
      await updateFlag("APP_MODE", "real", {
        mfaCode,
        secondApprover: {
          id: approver,
          approved: true,
        },
      });
      return;
    }
    await updateFlag("APP_MODE", nextMode);
  }

  function renderControl(key: FeatureKey) {
    const descriptor = FLAG_DESCRIPTORS[key];
    const value = flags[key];

    if (descriptor.type === "boolean") {
      const checked = Boolean(value);
      return (
        <label className="toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleBoolean(key, checked)}
            disabled={pendingKey === key}
          />
          <span className="slider" />
        </label>
      );
    }

    return (
      <div className="mode-selector">
        {(["sandbox", "pilot", "real"] as const).map(mode => (
          <button
            key={mode}
            className={`mode-pill${value === mode ? " active" : ""}`}
            onClick={() => changeMode(mode)}
            disabled={pendingKey === key}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="admin-modes">
      <header>
        <h1>Modes &amp; Simulators</h1>
        <p>Flip simulators, dry-run, and production mode without touching the CLI.</p>
      </header>

      {loading && <p>Loading feature flags…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && (
        <div className="flags-grid">
          {(Object.keys(FLAG_DESCRIPTORS) as FeatureKey[]).map(key => (
            <div key={key} className="flag-card">
              <div className="flag-card__header">
                <div>
                  <h3>{FLAG_DESCRIPTORS[key].label}</h3>
                  <p>{FLAG_DESCRIPTORS[key].description}</p>
                </div>
                <div>{renderControl(key)}</div>
              </div>
              {pendingKey === key && <p className="pending">Saving…</p>}
            </div>
          ))}
        </div>
      )}

      <section className="headers-preview">
        <h2>Live header preview</h2>
        <table>
          <tbody>
            {Object.entries(headerPreview).map(([header, value]) => (
              <tr key={header}>
                <th>{header}</th>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
