import React, { useMemo, useState, useCallback, useEffect } from "react";

type RiskBand = "high" | "medium" | "low";

interface ReconFactor {
  feature: string;
  direction: "positive" | "negative";
  description: string;
}

interface ReconRow {
  id: string;
  delta: number;
  delta_pct: number;
  age_days: number;
  amount: number;
  counterparty_freq: number;
  crn_valid: boolean;
  historical_adjustments: number;
  period_phase: "pre" | "close" | "post";
  pay_channel: string;
  retry_count: number;
  score: number;
  risk_band: RiskBand;
  top_factors: ReconFactor[];
}

interface ScoreApiResponse {
  model_version: string;
  scored: Array<{
    id: string;
    score: number;
    risk_band: RiskBand;
    top_factors: ReconFactor[];
  }>;
}

interface ReconSeedItem {
  id: string;
  delta: number;
  delta_pct: number;
  age_days: number;
  amount: number;
  counterparty_freq: number;
  crn_valid: boolean;
  historical_adjustments: number;
  period_phase: "pre" | "close" | "post";
  pay_channel: string;
  retry_count: number;
}

const RISK_LABELS: Record<RiskBand, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export default function Fraud() {
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [modelVersion, setModelVersion] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<"all" | RiskBand>("all");
  const [sortByRisk, setSortByRisk] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seedItems = useMemo<ReconSeedItem[]>(
    () => [
      {
        id: "GST-2025-06-001",
        delta: 820.45,
        delta_pct: 0.12,
        age_days: 9,
        amount: 41850,
        counterparty_freq: 2,
        crn_valid: false,
        historical_adjustments: 3,
        period_phase: "close",
        pay_channel: "PAYTO",
        retry_count: 2,
      },
      {
        id: "PAYGW-2025-06-008",
        delta: -110.12,
        delta_pct: 0.03,
        age_days: 4,
        amount: 12100,
        counterparty_freq: 18,
        crn_valid: true,
        historical_adjustments: 0,
        period_phase: "pre",
        pay_channel: "EFT",
        retry_count: 0,
      },
      {
        id: "GST-2025-06-014",
        delta: 1520.88,
        delta_pct: 0.19,
        age_days: 14,
        amount: 60550,
        counterparty_freq: 1,
        crn_valid: false,
        historical_adjustments: 5,
        period_phase: "close",
        pay_channel: "BPAY",
        retry_count: 3,
      },
      {
        id: "PAYGW-2025-06-010",
        delta: -540.32,
        delta_pct: 0.08,
        age_days: 18,
        amount: 9800,
        counterparty_freq: 4,
        crn_valid: true,
        historical_adjustments: 1,
        period_phase: "post",
        pay_channel: "CARD",
        retry_count: 1,
      },
      {
        id: "GST-2025-06-019",
        delta: 65.11,
        delta_pct: 0.01,
        age_days: 2,
        amount: 2100,
        counterparty_freq: 24,
        crn_valid: true,
        historical_adjustments: 0,
        period_phase: "pre",
        pay_channel: "EFT",
        retry_count: 0,
      },
      {
        id: "PAYGW-2025-06-017",
        delta: 890.23,
        delta_pct: 0.15,
        age_days: 27,
        amount: 30500,
        counterparty_freq: 3,
        crn_valid: false,
        historical_adjustments: 4,
        period_phase: "post",
        pay_channel: "PAYID",
        retry_count: 4,
      },
    ],
    []
  );

  const enrichRows = useCallback(
    (scored: ScoreApiResponse["scored"]): ReconRow[] => {
      const seedMap = new Map(seedItems.map((item) => [item.id, item]));
      return scored
        .map((row) => {
          const seed = seedMap.get(row.id);
          if (!seed) return null;
          return {
            ...seed,
            score: row.score,
            risk_band: row.risk_band,
            top_factors: row.top_factors,
          };
        })
        .filter((row): row is ReconRow => Boolean(row));
    },
    [seedItems]
  );

  const fetchScores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ml/recon/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: seedItems }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload: ScoreApiResponse = await response.json();
      setModelVersion(payload.model_version);
      setRows(enrichRows(payload.scored));
    } catch (err: any) {
      setError(err?.message || "Failed to score recon items");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [enrichRows, seedItems]);

  useEffect(() => {
    fetchScores();
  }, [fetchScores]);

  const displayedRows = useMemo(() => {
    const filtered = rows.filter((row) => (riskFilter === "all" ? true : row.risk_band === riskFilter));
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortByRisk) {
        return b.score - a.score;
      }
      if (b.age_days !== a.age_days) {
        return b.age_days - a.age_days;
      }
      return a.id.localeCompare(b.id);
    });
    return sorted;
  }, [rows, riskFilter, sortByRisk]);

  return (
    <div className="main-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30 }}>Recon anomaly queue</h1>
          <p style={{ color: "#4b5563", marginTop: 4 }}>
            Prioritise reconciliation deltas using the trained model (v{modelVersion || "?"}).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            style={{
              background: sortByRisk ? "#00716b" : "#e5e7eb",
              color: sortByRisk ? "#fff" : "#111827",
            }}
            onClick={() => setSortByRisk(true)}
          >
            Sort by ML risk
          </button>
          <button
            className="btn"
            style={{
              background: !sortByRisk ? "#00716b" : "#e5e7eb",
              color: !sortByRisk ? "#fff" : "#111827",
            }}
            onClick={() => setSortByRisk(false)}
          >
            Sort by age
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        {["all", "high", "medium", "low"].map((band) => {
          const active = riskFilter === band;
          return (
            <button
              key={band}
              className="btn"
              style={{
                background: active ? "#fde68a" : "#f3f4f6",
                color: active ? "#92400e" : "#4b5563",
              }}
              onClick={() => setRiskFilter(band as typeof riskFilter)}
            >
              {band === "all" ? "All" : `${RISK_LABELS[band as RiskBand]} risk`}
            </button>
          );
        })}
        <button className="btn" onClick={fetchScores} disabled={loading}>
          {loading ? "Scoring…" : "Refresh scores"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "12px 16px", borderRadius: 12, marginBottom: 16 }}>
          Failed to load scores: {error}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", background: "#f9fafb", color: "#4b5563" }}>
              <th style={{ padding: "12px 16px" }}>ID</th>
              <th style={{ padding: "12px 16px" }}>Δ ($)</th>
              <th style={{ padding: "12px 16px" }}>Δ %</th>
              <th style={{ padding: "12px 16px" }}>Amount ($)</th>
              <th style={{ padding: "12px 16px" }}>Age (days)</th>
              <th style={{ padding: "12px 16px" }}>Risk</th>
              <th style={{ padding: "12px 16px" }}>Score</th>
              <th style={{ padding: "12px 16px" }}>Top factors</th>
            </tr>
          </thead>
          <tbody>
            {displayedRows.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{row.id}</td>
                <td style={{ padding: "12px 16px" }}>${Math.abs(row.delta).toFixed(0)}</td>
                <td style={{ padding: "12px 16px" }}>{(Math.abs(row.delta_pct) * 100).toFixed(1)}%</td>
                <td style={{ padding: "12px 16px" }}>${row.amount.toLocaleString()}</td>
                <td style={{ padding: "12px 16px" }}>{row.age_days}</td>
                <td style={{ padding: "12px 16px", fontWeight: 600, color: row.risk_band === "high" ? "#b91c1c" : row.risk_band === "medium" ? "#d97706" : "#047857" }}>
                  {RISK_LABELS[row.risk_band]}
                </td>
                <td style={{ padding: "12px 16px" }}>{row.score.toFixed(2)}</td>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {row.top_factors.map((factor, index) => (
                      <span
                        key={`${row.id}-${factor.feature}-${index}`}
                        style={{
                          background: factor.direction === "positive" ? "#fee2e2" : "#dcfce7",
                          color: factor.direction === "positive" ? "#991b1b" : "#166534",
                          padding: "4px 8px",
                          borderRadius: 999,
                          fontSize: 12,
                        }}
                        title={`${factor.feature}: ${factor.direction}`}
                      >
                        {factor.description}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && displayedRows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: "24px", textAlign: "center", color: "#6b7280" }}>
                  No recon items match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
