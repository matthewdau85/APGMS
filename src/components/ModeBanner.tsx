import React, { useEffect, useMemo, useState } from "react";

type ReadinessMode = "prototype" | "real";

interface ReadinessCheck {
  key: string;
  label: string;
  mode: ReadinessMode;
  ok: boolean;
  details: string;
  helpUrl?: string;
}

interface Scorecard {
  score: number;
  max: number;
  checks: ReadinessCheck[];
}

interface ReadinessResponse {
  rubric: { version: string };
  prototype: Scorecard;
  real: Scorecard;
  timestamp: string;
  appMode: string;
}

const ModeBanner: React.FC = () => {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const response = await fetch("/ops/readiness");
        if (!response.ok) {
          throw new Error(`Readiness request failed (${response.status})`);
        }
        const payload: ReadinessResponse = await response.json();
        if (!isMounted) return;
        setReadiness(payload);
        setError(null);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Unable to load readiness");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const failingChecks = useMemo(() => {
    if (!readiness) return [] as ReadinessCheck[];
    return [...readiness.prototype.checks, ...readiness.real.checks].filter(
      (check) => !check.ok,
    );
  }, [readiness]);

  const bannerText = useMemo(() => {
    if (loading) return "Loading readiness…";
    if (error || !readiness)
      return "Readiness unavailable";
    return `Prototype readiness: ${readiness.prototype.score}/${readiness.prototype.max} • Real readiness: ${readiness.real.score}/${readiness.real.max} • Rubric v${readiness.rubric.version}`;
  }, [loading, error, readiness]);

  const timestampText = readiness
    ? new Date(readiness.timestamp).toLocaleString()
    : "";

  const handleToggleDrawer = () => {
    if (loading || error) return;
    setDrawerOpen((open) => !open);
  };

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      <div className="mode-banner" role="status" aria-live="polite">
        <span className="mode-banner__text">{bannerText}</span>
        <button
          type="button"
          className="mode-banner__button"
          onClick={handleToggleDrawer}
          disabled={loading || !!error}
        >
          See details
        </button>
      </div>

      <div className={`readiness-drawer${drawerOpen ? " open" : ""}`}>
        <div className="readiness-drawer__header">
          <div>
            <h2>Readiness details</h2>
            {readiness && (
              <p>
                Mode: <strong>{readiness.appMode}</strong> • Updated: {timestampText}
              </p>
            )}
          </div>
          <button
            type="button"
            className="readiness-drawer__close"
            onClick={closeDrawer}
            aria-label="Close readiness details"
          >
            ×
          </button>
        </div>

        <div className="readiness-drawer__body">
          {loading && <p>Loading readiness…</p>}
          {error && !loading && <p className="readiness-error">{error}</p>}
          {!loading && !error && readiness && failingChecks.length === 0 && (
            <p>All readiness checks are passing.</p>
          )}
          {!loading && !error && readiness && failingChecks.length > 0 && (
            <ul className="readiness-check-list">
              {failingChecks.map((check) => (
                <li key={check.key} className="readiness-check">
                  <div className="readiness-check__title">
                    <span className={`readiness-badge readiness-badge--${check.mode}`}>
                      {check.mode === "prototype" ? "Prototype" : "Real"}
                    </span>
                    <span className="readiness-check__label">{check.label}</span>
                  </div>
                  <p className="readiness-check__details">{check.details}</p>
                  {check.helpUrl && (
                    <a
                      href={check.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="readiness-check__link"
                    >
                      View runbook
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {drawerOpen && (
        <div
          className="readiness-drawer__overlay"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}
    </>
  );
};

export default ModeBanner;
