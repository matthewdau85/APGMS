import React, { useEffect, useState } from "react";
import { EmptyState, LoadingState } from "../ui/states";

type FraudAlert = {
  date: string;
  detail: string;
  severity: "warning" | "critical";
};

export default function Fraud() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const timer = setTimeout(() => {
      if (!cancelled) {
        setAlerts([
          { date: "02/06/2025", detail: "PAYGW payment skipped (flagged)", severity: "critical" },
          { date: "16/05/2025", detail: "GST transfer lower than usual", severity: "warning" },
        ]);
        setIsLoading(false);
      }
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const rerunAnalysis = () => {
    setIsLoading(true);
    setAlerts([]);
    setTimeout(() => {
      setAlerts([
        { date: "02/06/2025", detail: "PAYGW payment skipped (flagged)", severity: "critical" },
        { date: "16/05/2025", detail: "GST transfer lower than usual", severity: "warning" },
      ]);
      setIsLoading(false);
    }, 600);
  };

  return (
    <div className="main-card space-y-6">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30 }}>Fraud Detection</h1>

      {isLoading && (
        <LoadingState label="Running anomaly detection across PAYGW and GST transfers" />
      )}

      {!isLoading && alerts.length === 0 && (
        <EmptyState
          title="No anomalies detected"
          body="Keep PAYGW and GST transfers consistent with your pattern. We'll alert you instantly if anything unusual happens."
          ctaLabel="Request a manual review"
          onCta={() => alert("A compliance specialist will review your transfers.")}
        />
      )}

      {!isLoading && alerts.length > 0 && (
        <div className="space-y-4">
          <div>
            <h3>Alerts</h3>
            <ul>
              {alerts.map((row, i) => (
                <li
                  key={i}
                  style={{
                    color: row.severity === "critical" ? "#c53030" : "#b7791f",
                    fontWeight: 500,
                    marginBottom: 7,
                  }}
                >
                  {row.date}: {row.detail}
                </li>
              ))}
            </ul>
          </div>
          <button className="button" onClick={rerunAnalysis}>
            Re-run analysis
          </button>
        </div>
      )}
    </div>
  );
}
