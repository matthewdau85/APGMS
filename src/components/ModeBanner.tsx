import React, { useEffect, useMemo, useState } from "react";

interface CheckResult {
  key: string;
  ok: boolean;
  details: string;
  helpUrl?: string;
}

interface ScorecardSnapshot {
  score: number;
  max: number;
  checks: CheckResult[];
}

interface ReadinessSnapshot {
  rubric: { version: string };
  prototype: ScorecardSnapshot;
  real: ScorecardSnapshot;
  timestamp: string;
  appMode: string;
}

const REFRESH_MS = 60_000;

export default function ModeBanner() {
  const [snapshot, setSnapshot] = useState<ReadinessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadReadiness() {
      try {
        const response = await fetch("/ops/readiness", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const payload: ReadinessSnapshot = await response.json();
        if (!cancelled) {
          setSnapshot(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSnapshot(null);
        }
      }
    }

    loadReadiness();
    const timer = window.setInterval(loadReadiness, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const failingChecks = useMemo(() => {
    if (!snapshot) {
      return { prototype: [] as CheckResult[], real: [] as CheckResult[] };
    }
    return {
      prototype: snapshot.prototype.checks.filter((check) => !check.ok),
      real: snapshot.real.checks.filter((check) => !check.ok),
    };
  }, [snapshot]);

  const summaryText = snapshot
    ? `Prototype readiness: ${snapshot.prototype.score}/${snapshot.prototype.max} • Real readiness: ${snapshot.real.score}/${snapshot.real.max} • Rubric v${snapshot.rubric.version}`
    : error
    ? "Readiness unavailable"
    : "Checking readiness…";

  return (
    <>
      <div className={`mode-banner${error ? " mode-banner--error" : ""}`}>
        <span className="mode-banner__summary">{summaryText}</span>
        {snapshot ? (
          <button
            type="button"
            className="mode-banner__cta"
            onClick={() => setDrawerOpen(true)}
          >
            See details
          </button>
        ) : null}
      </div>

      {drawerOpen && <div className="readiness-backdrop" onClick={() => setDrawerOpen(false)} />}

      <aside className={`readiness-drawer${drawerOpen ? " readiness-drawer--open" : ""}`}>
        <div className="readiness-drawer__header">
          <h3>Readiness details</h3>
          <button type="button" onClick={() => setDrawerOpen(false)}>
            Close
          </button>
        </div>
        <div className="readiness-drawer__body">
          {snapshot ? (
            <>
              <p className="readiness-drawer__meta">
                Last updated {new Date(snapshot.timestamp).toLocaleString()} • Mode: {snapshot.appMode}
              </p>
              <section>
                <h4>Prototype checks</h4>
                {failingChecks.prototype.length === 0 ? (
                  <p className="readiness-drawer__empty">All prototype checks passing.</p>
                ) : (
                  <ul>
                    {failingChecks.prototype.map((check) => (
                      <li key={check.key}>
                        <strong>{check.key}</strong>
                        <span>{check.details}</span>
                        {check.helpUrl ? (
                          <a href={check.helpUrl} target="_blank" rel="noreferrer">
                            Get help
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h4>Real checks</h4>
                {failingChecks.real.length === 0 ? (
                  <p className="readiness-drawer__empty">All real-mode checks passing.</p>
                ) : (
                  <ul>
                    {failingChecks.real.map((check) => (
                      <li key={check.key}>
                        <strong>{check.key}</strong>
                        <span>{check.details}</span>
                        {check.helpUrl ? (
                          <a href={check.helpUrl} target="_blank" rel="noreferrer">
                            Get help
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <p className="readiness-drawer__empty">
              {error ? `Unable to load readiness: ${error}` : "Loading readiness…"}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
