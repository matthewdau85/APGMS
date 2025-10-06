import React from "react";
import { createRoot } from "react-dom/client";

type HelpDoc = {
  id: string;
  title: string;
  summary: string;
  citations: string[];
  body: string;
  ruleRefs: string[];
};

type PaygiVariationPayload = {
  baseline_installment: number;
  installments_paid: number;
  credits_to_date: number;
  estimated_year_tax: number;
  remaining_installments: number;
  target_percentage: number;
};

type PaygiVariationPreview = ReturnType<typeof simulatePaygiVariation>;

type RatesChangePayload = {
  annual_taxable_income: number;
  pay_frequency: "weekly" | "fortnightly" | "monthly" | "quarterly";
  period_start: string;
  period_end: string;
  change_effective: string;
  current_version: keyof typeof RATE_SCHEDULES;
  next_version: keyof typeof RATE_SCHEDULES;
};

type RatesChangePreview = ReturnType<typeof simulateRatesChange>;

type RateSegment = {
  label: string;
  start: string;
  end: string;
  rates_version: string;
  coverage: string;
};

const helpDocs: HelpDoc[] = [
  {
    id: "paygw",
    title: "PAYG Withholding",
    summary: "Stage 3 thresholds and JSON rule locations for PAYGW.",
    citations: ["NAT 1007", "PS LA 2012/6"],
    body:
      "Stage 3 adjustments are encoded per rates_version and APGMS will flag a banner when multiple schedules overlap the same reporting period.",
    ruleRefs: [
      "apps/services/tax-engine/app/rules/payg_w_2024_25.json",
      "apps/services/tax-engine/app/domains/payg_w.py",
    ],
  },
  {
    id: "paygi",
    title: "PAYG Instalments",
    summary: "Safe-harbour variation walkthrough.",
    citations: ["NAT 4159", "PS LA 2011/12"],
    body:
      "Capture estimated annual tax, instalments paid, and credits to produce the minimum rate that satisfies the 85% safe harbour. The ledger never changes during a what-if preview.",
    ruleRefs: ["portal-api/app.py"],
  },
  {
    id: "gst",
    title: "GST",
    summary: "Baseline GST attribution notes.",
    citations: ["NAT 5107", "PS LA 2012/2"],
    body:
      "GST HelpTips remind operators which NAT schedules govern BAS disclosures when mixed supplies are present.",
    ruleRefs: ["apps/services/tax-engine/app/tax_rules.py"],
  },
];

const RATE_SCHEDULES = {
  "2024-25": [
    { threshold: 0, limit: 18200, rate: 0 },
    { threshold: 18200, limit: 45000, rate: 0.16 },
    { threshold: 45000, limit: 135000, rate: 0.30 },
    { threshold: 135000, limit: 190000, rate: 0.37 },
    { threshold: 190000, limit: Infinity, rate: 0.45 },
  ],
  "2025-26": [
    { threshold: 0, limit: 20000, rate: 0 },
    { threshold: 20000, limit: 45000, rate: 0.15 },
    { threshold: 45000, limit: 130000, rate: 0.28 },
    { threshold: 130000, limit: 190000, rate: 0.34 },
    { threshold: 190000, limit: Infinity, rate: 0.42 },
  ],
} as const;

type RateVersion = keyof typeof RATE_SCHEDULES;

const PERIODS_PER_YEAR = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
} as const;

const API_BASE = (import.meta as any)?.env?.VITE_API_BASE ?? "http://localhost:8000";

function roundCurrency(value: number) {
  return Math.round((value + 1e-9) * 100) / 100;
}

function simulatePaygiVariation(payload: PaygiVariationPayload) {
  const targetTax = payload.estimated_year_tax * payload.target_percentage;
  const paidInstallments = payload.installments_paid * payload.baseline_installment;
  const paidToDate = paidInstallments + payload.credits_to_date;
  const remainingLiability = Math.max(targetTax - paidToDate, 0);
  const perInstallment =
    payload.remaining_installments > 0
      ? remainingLiability / payload.remaining_installments
      : 0;
  const variationFactor = payload.baseline_installment
    ? perInstallment / payload.baseline_installment
    : null;

  return {
    safe_harbor_percentage: roundCurrency(payload.target_percentage),
    target_amount: roundCurrency(targetTax),
    paid_to_date: roundCurrency(paidToDate),
    remaining_liability: roundCurrency(remainingLiability),
    recommended_installment: roundCurrency(perInstallment),
    variation_factor: variationFactor == null ? null : roundCurrency(variationFactor),
    ledger_impact: "none",
    notes: [
      "NAT 4159 PAYG instalment guide outlines the 85% safe harbour test.",
      "PS LA 2011/12 explains Commissioner discretions for PAYGI variations.",
    ],
    ledger_snapshot: 0,
  } as const;
}

function annualTax(amount: number, version: RateVersion) {
  const brackets = RATE_SCHEDULES[version];
  let tax = 0;
  for (const bracket of brackets) {
    if (amount <= bracket.threshold) {
      break;
    }
    const upper = Math.min(amount, bracket.limit);
    const taxable = Math.max(0, upper - bracket.threshold);
    tax += taxable * bracket.rate;
    if (amount <= bracket.limit) {
      break;
    }
  }
  return tax;
}

function simulateRatesChange(payload: RatesChangePayload) {
  const current = annualTax(payload.annual_taxable_income, payload.current_version);
  const upcoming = annualTax(payload.annual_taxable_income, payload.next_version);
  const periods = PERIODS_PER_YEAR[payload.pay_frequency];
  const perPeriodCurrent = periods ? current / periods : 0;
  const perPeriodUpcoming = periods ? upcoming / periods : 0;
  const delta = perPeriodUpcoming - perPeriodCurrent;

  const start = new Date(payload.period_start);
  const end = new Date(payload.period_end);
  const change = new Date(payload.change_effective);

  const segments: RateSegment[] = [];
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(change.getTime())) {
    segments.push({
      label: "Unknown schedule",
      start: payload.period_start,
      end: payload.period_end,
      rates_version: payload.current_version,
      coverage: "100%",
    });
  } else {
    let realStart = start;
    let realEnd = end;
    if (realEnd.getTime() < realStart.getTime()) {
      [realStart, realEnd] = [realEnd, realStart];
    }
    if (change.getTime() <= realStart.getTime()) {
      segments.push({
        label: "Upcoming schedule applies for the full period",
        start: realStart.toISOString().slice(0, 10),
        end: realEnd.toISOString().slice(0, 10),
        rates_version: payload.next_version,
        coverage: "100%",
      });
    } else if (change.getTime() > realEnd.getTime()) {
      segments.push({
        label: "Current schedule applies for the full period",
        start: realStart.toISOString().slice(0, 10),
        end: realEnd.toISOString().slice(0, 10),
        rates_version: payload.current_version,
        coverage: "100%",
      });
    } else {
      const spanDays = Math.max(
        1,
        Math.round((realEnd.getTime() - realStart.getTime()) / 86_400_000) + 1,
      );
      const priorEnd = new Date(change.getTime() - 86_400_000);
      const beforeDays = Math.max(
        0,
        Math.round((priorEnd.getTime() - realStart.getTime()) / 86_400_000) + 1,
      );
      const afterDays = Math.max(
        0,
        Math.round((realEnd.getTime() - change.getTime()) / 86_400_000) + 1,
      );
      const toPct = (days: number) => `${Math.round((days / spanDays) * 1000) / 10}%`;
      if (beforeDays > 0) {
        segments.push({
          label: "Current schedule",
          start: realStart.toISOString().slice(0, 10),
          end: priorEnd.toISOString().slice(0, 10),
          rates_version: payload.current_version,
          coverage: toPct(beforeDays),
        });
      }
      segments.push({
        label: "Upcoming schedule",
        start: change.toISOString().slice(0, 10),
        end: realEnd.toISOString().slice(0, 10),
        rates_version: payload.next_version,
        coverage: toPct(afterDays),
      });
    }
  }

  return {
    annual: {
      current: roundCurrency(current),
      upcoming: roundCurrency(upcoming),
      delta: roundCurrency(upcoming - current),
    },
    per_period: {
      current: roundCurrency(perPeriodCurrent),
      upcoming: roundCurrency(perPeriodUpcoming),
      delta: roundCurrency(delta),
    },
    segments,
    rates_versions: {
      current: payload.current_version,
      upcoming: payload.next_version,
    },
    effective_from: payload.change_effective,
    ledger_impact: "none",
    notes: [
      "NAT 1007 and related schedules provide the PAYG-W rate tables per financial year.",
      "PS LA 2012/6 documents how Treasury rate changes transition mid-period.",
    ],
    ledger_snapshot: 0,
  } as const;
}

async function fetchOrSimulate<T>(
  path: string,
  payload: Record<string, any>,
  fallback: (payload: any) => T,
): Promise<T> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Unexpected ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn("Falling back to client-side simulation", err);
    return fallback(payload);
  }
}

function HelpTip({ docId, onOpen }: { docId: string; onOpen: (doc: HelpDoc) => void }) {
  const doc = helpDocs.find((d) => d.id === docId);
  if (!doc) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(doc)}
      style={{
        marginLeft: 8,
        borderRadius: "50%",
        width: 24,
        height: 24,
        border: "1px solid #555",
        background: "#f5f5f5",
        cursor: "pointer",
      }}
      aria-label={`Open help for ${doc.title}`}
    >
      ?
    </button>
  );
}

function Section({ title, children, helpId }: { title: string; children: React.ReactNode; helpId?: string }) {
  const [activeDoc, setActiveDoc] = React.useState<HelpDoc | null>(null);
  const open = (doc: HelpDoc) => setActiveDoc(doc);
  return (
    <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 12, background: "#fff" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {helpId ? <HelpTip docId={helpId} onOpen={open} /> : null}
      </header>
      <div style={{ marginTop: 12 }}>{children}</div>
      {activeDoc && (
        <HelpDialog doc={activeDoc} onClose={() => setActiveDoc(null)} />
      )}
    </section>
  );
}

function HelpDialog({ doc, onClose }: { doc: HelpDoc; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
      }}
    >
      <article style={{ background: "white", padding: 24, maxWidth: 520, borderRadius: 16, boxShadow: "0 12px 32px rgba(0,0,0,0.2)" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: "0 0 4px 0" }}>{doc.title}</h3>
            <small>{doc.citations.join(", ")}</small>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
            ×
          </button>
        </header>
        <div style={{ marginTop: 12, lineHeight: 1.6 }}>
          {doc.body.split(/\n\n/).map((block, idx) => (
            <p key={idx} style={{ marginTop: idx === 0 ? 0 : 12 }}>
              {block}
            </p>
          ))}
        </div>
        <footer style={{ marginTop: 16 }}>
          <strong>Rule references</strong>
          <ul>
            {doc.ruleRefs.map((ref) => (
              <li key={ref} style={{ fontFamily: "monospace" }}>
                {ref}
              </li>
            ))}
          </ul>
        </footer>
      </article>
    </div>
  );
}

function App() {
  const [variationInput, setVariationInput] = React.useState<PaygiVariationPayload>({
    baseline_installment: 1500,
    installments_paid: 2,
    credits_to_date: 5000,
    estimated_year_tax: 42000,
    remaining_installments: 2,
    target_percentage: 0.85,
  });
  const [variationPreview, setVariationPreview] = React.useState<PaygiVariationPreview | null>(null);

  const [ratesInput, setRatesInput] = React.useState<RatesChangePayload>({
    annual_taxable_income: 120000,
    pay_frequency: "monthly",
    period_start: "2025-06-01",
    period_end: "2025-09-30",
    change_effective: "2025-07-01",
    current_version: "2024-25",
    next_version: "2025-26",
  });
  const [ratesPreview, setRatesPreview] = React.useState<RatesChangePreview | null>(null);
  const [segmentsOpen, setSegmentsOpen] = React.useState(false);
  const [activeHelp, setActiveHelp] = React.useState<HelpDoc | null>(null);

  const loadVariation = React.useCallback(async () => {
    const preview = await fetchOrSimulate("/what-if/paygi-variation", variationInput, simulatePaygiVariation);
    setVariationPreview(preview);
  }, [variationInput]);

  const loadRates = React.useCallback(async () => {
    const preview = await fetchOrSimulate("/what-if/rates-change", ratesInput, simulateRatesChange);
    setRatesPreview(preview);
  }, [ratesInput]);

  React.useEffect(() => {
    void loadVariation();
    void loadRates();
  }, [loadVariation, loadRates]);

  const showBanner = (ratesPreview?.segments?.length ?? 0) > 1;

  return (
    <div
      style={{
        padding: 24,
        fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#f0f3f8",
        minHeight: "100vh",
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4 }}>APGMS Console</h1>
        <p style={{ marginTop: 0, color: "#334", maxWidth: 720 }}>
          Monitor regime changes, preview PAYGI variations safely, and jump straight to annotated NAT/PS LA guidance via HelpTips.
        </p>
      </header>

      {showBanner && ratesPreview && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSegmentsOpen((open) => !open)}
          onKeyDown={(evt) => {
            if (evt.key === "Enter" || evt.key === " ") {
              evt.preventDefault();
              setSegmentsOpen((open) => !open);
            }
          }}
          style={{
            border: "1px solid #c9981f",
            background: "#fff8e6",
            padding: 16,
            borderRadius: 12,
            marginBottom: 24,
            cursor: "pointer",
            boxShadow: segmentsOpen ? "0 8px 20px rgba(0,0,0,0.12)" : "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <strong>Heads up:</strong> Rates shift during this period. Click to view the {ratesPreview.segments.length} segments.
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ratesPreview.segments.map((segment) => (
              <span
                key={`${segment.start}-${segment.rates_version}`}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "#fff",
                  border: "1px solid #c9981f",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {segment.rates_version}
              </span>
            ))}
          </div>
          {segmentsOpen && (
            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              {ratesPreview.segments.map((segment) => (
                <div key={`${segment.start}-${segment.end}`} style={{ padding: 12, background: "#fff", borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>{segment.label}</div>
                  <div style={{ fontSize: 13, color: "#444" }}>
                    {segment.start} → {segment.end} · {segment.rates_version} · {segment.coverage} coverage
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 24 }}>
        <Section title="PAYGI variation calculator" helpId="paygi">
          <form
            onSubmit={(evt) => {
              evt.preventDefault();
              void loadVariation();
            }}
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              alignItems: "end",
            }}
          >
            {(
              [
                {
                  label: "Baseline installment",
                  field: "baseline_installment" as const,
                },
                { label: "Installments paid", field: "installments_paid" as const },
                { label: "Credits to date", field: "credits_to_date" as const },
                { label: "Estimated year tax", field: "estimated_year_tax" as const },
                { label: "Remaining installments", field: "remaining_installments" as const },
                { label: "Safe harbour %", field: "target_percentage" as const },
              ]
            ).map(({ label, field }) => (
              <label key={field} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>{label}</span>
                <input
                  type="number"
                  step="any"
                  value={variationInput[field]}
                  onChange={(evt) =>
                    setVariationInput((prev) => ({ ...prev, [field]: Number(evt.target.value) }))
                  }
                  style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
                />
              </label>
            ))}
            <button
              type="submit"
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#2449d8",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Preview variation
            </button>
          </form>
          <pre
            style={{
              marginTop: 16,
              background: "#0b1220",
              color: "#e4f1ff",
              padding: 16,
              borderRadius: 12,
              overflowX: "auto",
            }}
          >
            {variationPreview ? JSON.stringify(variationPreview, null, 2) : "Loading preview..."}
          </pre>
        </Section>

        <Section title="Upcoming rate change preview" helpId="paygw">
          <form
            onSubmit={(evt) => {
              evt.preventDefault();
              void loadRates();
            }}
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              alignItems: "end",
            }}
          >
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Annual taxable income</span>
              <input
                type="number"
                step="any"
                value={ratesInput.annual_taxable_income}
                onChange={(evt) =>
                  setRatesInput((prev) => ({ ...prev, annual_taxable_income: Number(evt.target.value) }))
                }
                style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              <span>Pay frequency</span>
              <select
                value={ratesInput.pay_frequency}
                onChange={(evt) =>
                  setRatesInput((prev) => ({ ...prev, pay_frequency: evt.target.value as RatesChangePayload["pay_frequency"] }))
                }
                style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
              >
                {Object.keys(PERIODS_PER_YEAR).map((freq) => (
                  <option key={freq} value={freq}>
                    {freq}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                { label: "Period start", field: "period_start" as const },
                { label: "Period end", field: "period_end" as const },
                { label: "Effective change", field: "change_effective" as const },
              ]
            ).map(({ label, field }) => (
              <label key={field} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>{label}</span>
                <input
                  type="date"
                  value={ratesInput[field]}
                  onChange={(evt) =>
                    setRatesInput((prev) => ({ ...prev, [field]: evt.target.value }))
                  }
                  style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
                />
              </label>
            ))}
            {(
              [
                { label: "Current version", field: "current_version" as const },
                { label: "Next version", field: "next_version" as const },
              ]
            ).map(({ label, field }) => (
              <label key={field} style={{ display: "grid", gap: 4, fontSize: 13 }}>
                <span>{label}</span>
                <select
                  value={ratesInput[field]}
                  onChange={(evt) =>
                    setRatesInput((prev) => ({ ...prev, [field]: evt.target.value as RateVersion }))
                  }
                  style={{ padding: 8, borderRadius: 8, border: "1px solid #ccc" }}
                >
                  {(Object.keys(RATE_SCHEDULES) as RateVersion[]).map((version) => (
                    <option key={version} value={version}>
                      {version}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              type="submit"
              style={{
                padding: "10px 16px",
                borderRadius: 8,
                border: "none",
                background: "#0c7b6c",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Preview rates
            </button>
          </form>
          <pre
            style={{
              marginTop: 16,
              background: "#0b1220",
              color: "#e4f1ff",
              padding: 16,
              borderRadius: 12,
              overflowX: "auto",
            }}
          >
            {ratesPreview ? JSON.stringify(ratesPreview, null, 2) : "Loading preview..."}
          </pre>
        </Section>

        <section style={{ border: "1px solid #ddd", padding: 16, borderRadius: 12, background: "#fff" }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Help center</h2>
            <HelpTip docId="gst" onOpen={(doc) => setActiveHelp(doc)} />
          </header>
          <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
            {helpDocs.map((doc) => (
              <article key={doc.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
                <h3 style={{ margin: "0 0 4px 0" }}>{doc.title}</h3>
                <p style={{ margin: 0, color: "#4d5669" }}>{doc.summary}</p>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {doc.citations.map((cite) => (
                    <span key={cite} style={{ padding: "2px 8px", borderRadius: 999, background: "#eef2ff", fontSize: 12 }}>
                      {cite}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveHelp(doc)}
                  style={{
                    marginTop: 12,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #2449d8",
                    background: "white",
                    color: "#2449d8",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Open guidance
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>

      {activeHelp && <HelpDialog doc={activeHelp} onClose={() => setActiveHelp(null)} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
