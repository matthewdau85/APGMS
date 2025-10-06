import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type Factor = {
  label: string;
  weight: number;
};

type ReconCandidate = {
  id: string;
  customer: string;
  statementRef: string;
  amount: number;
  ageDays: number;
  mlScore: number;
  manualOrder: number;
  topFactors: Factor[];
  note: string;
};

type BankMatchSuggestion = {
  id: string;
  payee: string;
  journalRef: string;
  amount: number;
  confidence: number;
  signalSummary: string;
};

type ForecastSeries = {
  id: string;
  title: string;
  horizon: string;
  modelCard: string;
  primary: number[];
  lower: number[];
  upper: number[];
  intentSummary: string;
};

type InvoiceDraft = {
  id: string;
  vendor: string;
  description: string;
  glAccount: string;
  amount: number;
  confidence: number;
  status: "ready" | "review";
};

const panelStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: 16,
  padding: 24,
  boxShadow: "0 10px 25px rgba(15, 23, 42, 0.08)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const advisoryBadgeStyle: React.CSSProperties = {
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 11,
  fontWeight: 600,
  padding: "4px 8px",
  borderRadius: 999,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const tooltipBubble: React.CSSProperties = {
  position: "absolute",
  top: "120%",
  right: 0,
  zIndex: 20,
  background: "#0f172a",
  color: "#f8fafc",
  padding: "8px 10px",
  borderRadius: 8,
  width: 220,
  boxShadow: "0 10px 18px rgba(15, 23, 42, 0.25)",
  fontSize: 12,
  lineHeight: 1.4,
};

type ModalProps = {
  title: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
};

function Modal({ title, confirmLabel = "Confirm", onConfirm, onCancel, children }: ModalProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 200,
        padding: 24,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div style={{ ...panelStyle, width: "min(560px, 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h3>
        </div>
        <div style={{ fontSize: 14, color: "#334155" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button
            onClick={onCancel}
            style={{
              borderRadius: 12,
              padding: "8px 16px",
              border: "1px solid #cbd5f5",
              background: "#ffffff",
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              borderRadius: 12,
              padding: "8px 16px",
              border: "none",
              background: "#0f766e",
              color: "white",
              fontWeight: 600,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdvisoryBadge() {
  return <span style={advisoryBadgeStyle}>ML Advisory</span>;
}

type WhyLinkProps = { href: string };

function WhyLink({ href }: WhyLinkProps) {
  return (
    <a
      style={{ fontSize: 12, color: "#0f766e", fontWeight: 600 }}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      Why am I seeing this?
    </a>
  );
}

type TooltipProps = {
  activator: React.ReactNode;
  content: React.ReactNode;
};

function Tooltip({ activator, content }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ cursor: "pointer", color: "#0f766e" }}
        tabIndex={0}
      >
        {activator}
      </span>
      {open && <div style={tooltipBubble}>{content}</div>}
    </span>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 2,
  }).format(value);
}

function ReconQueuePanel() {
  const [rankByML, setRankByML] = useState(true);
  const candidates = useMemo<ReconCandidate[]>(
    () => [
      {
        id: "R-1042",
        customer: "Helios Solar",
      statementRef: "OB-9823",
      amount: 1284.35,
      ageDays: 2,
      mlScore: 0.98,
      manualOrder: 3,
      topFactors: [
        { label: "Recurring match pattern", weight: 0.41 },
        { label: "Description similarity", weight: 0.34 },
        { label: "Netting behaviour", weight: 0.17 },
      ],
      note: "Similar to prior cleared sweep on 24 Sep.",
    },
    {
      id: "R-1043",
      customer: "Clarke Transport",
      statementRef: "OB-9825",
      amount: 922.1,
      ageDays: 3,
      mlScore: 0.91,
      manualOrder: 1,
      topFactors: [
        { label: "GST class alignment", weight: 0.29 },
        { label: "Historical tolerance", weight: 0.26 },
        { label: "Reconciler preference", weight: 0.18 },
      ],
      note: "Confidence slightly impacted by timing drift (2.3d).",
    },
    {
      id: "R-1044",
      customer: "Metro Engineering",
      statementRef: "OB-9830",
      amount: 1844.92,
      ageDays: 6,
      mlScore: 0.88,
      manualOrder: 2,
      topFactors: [
        { label: "Statement memo overlap", weight: 0.31 },
        { label: "Counterparty IBAN", weight: 0.27 },
        { label: "Seasonal variance", weight: 0.14 },
      ],
      note: "Manual review suggested due to older open invoice.",
      },
    ],
    [],
  );

  const ordered = useMemo(() => {
    const list = [...candidates];
    if (rankByML) {
      return list.sort((a, b) => b.mlScore - a.mlScore);
    }
    return list.sort((a, b) => a.manualOrder - b.manualOrder);
  }, [rankByML, candidates]);

  return (
    <section style={panelStyle} aria-labelledby="recon-heading">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AdvisoryBadge />
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Reconciliation queue</span>
          </div>
          <h2 id="recon-heading" style={{ fontSize: 20, fontWeight: 600 }}>Prioritise ledger exceptions</h2>
          <p style={{ fontSize: 14, color: "#475569", maxWidth: 520 }}>
            ML ordering highlights items likely to clear with minimal adjustment. You can toggle to the legacy manual ranking at any
            time.
          </p>
        </div>
        <WhyLink href="https://example.com/model-cards/recon-prioritiser" />
      </header>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#334155" }}>
          <input
            type="checkbox"
            checked={rankByML}
            onChange={(event) => setRankByML(event.target.checked)}
          />
          Rank by ML confidence
        </label>
        <Tooltip
          activator={<span style={{ fontSize: 12 }}>View ranking factors</span>}
          content={
            <div>
              <strong>Top factors combine behaviour, description and timing signals.</strong>
              <p style={{ marginTop: 8 }}>
                Hover each row to see the factors explaining its current confidence.
              </p>
            </div>
          }
        />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#475569" }}>
              {[
                "Statement ref",
                "Counterparty",
                "Amount",
                "Age",
                "Confidence",
                "Explanation",
              ].map((heading) => (
                <th key={heading} style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map((item) => (
              <tr
                key={item.id}
                style={{ borderBottom: "1px solid #e2e8f0", background: "#fff" }}
              >
                <td style={{ padding: "12px" }}>{item.statementRef}</td>
                <td style={{ padding: "12px" }}>{item.customer}</td>
                <td style={{ padding: "12px", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.amount)}</td>
                <td style={{ padding: "12px" }}>{item.ageDays} days</td>
                <td style={{ padding: "12px" }}>
                  <span style={{ fontWeight: 600 }}>{(item.mlScore * 100).toFixed(1)}%</span>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Advisory confidence</div>
                </td>
                <td style={{ padding: "12px", position: "relative" }}>
                  <Tooltip
                    activator={<span style={{ textDecoration: "underline", textDecorationStyle: "dotted" }}>Top factors</span>}
                    content={
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {item.topFactors.map((factor) => (
                          <li key={factor.label}>
                            {factor.label} · {(factor.weight * 100).toFixed(0)}%
                          </li>
                        ))}
                      </ul>
                    }
                  />
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>{item.note}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BankMatchingPanel() {
  const [showModal, setShowModal] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const suggestions = useMemo<BankMatchSuggestion[]>(
    () => [
      {
        id: "BM-781",
        payee: "Zen Payroll AU",
      journalRef: "PR-2025-09",
      amount: 16450.23,
      confidence: 0.97,
      signalSummary: "STP batch alignment, settlement window 26h",
    },
    {
      id: "BM-785",
      payee: "ATO Integrated Client",
      journalRef: "GST-2025-09",
      amount: 8200.0,
      confidence: 0.96,
      signalSummary: "ATO direct debit match & net obligation",
    },
    {
      id: "BM-790",
      payee: "SecureSuper",
      journalRef: "SGC-2025-09",
      amount: 3925.44,
      confidence: 0.93,
      signalSummary: "Plan mismatch (requires manual check)",
      },
    ],
    [],
  );

  const eligible = useMemo(() => suggestions.filter((item) => item.confidence >= 0.95), [suggestions]);

  return (
    <section style={panelStyle} aria-labelledby="bank-matching-heading">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AdvisoryBadge />
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Bank matching</span>
          </div>
          <h2 id="bank-matching-heading" style={{ fontSize: 20, fontWeight: 600 }}>Suggested settlement matches</h2>
          <p style={{ fontSize: 14, color: "#475569", maxWidth: 520 }}>
            Review the ML recommended pairings before applying them to your ledger. Matches below the confidence threshold remain in
            the manual queue.
          </p>
        </div>
        <WhyLink href="https://example.com/model-cards/bank-matcher" />
      </header>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#475569" }}>
              {[
                "Bank payee",
                "Journal reference",
                "Amount",
                "Confidence",
                "Signals",
              ].map((heading) => (
                <th key={heading} style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {suggestions.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
                <td style={{ padding: "12px" }}>{item.payee}</td>
                <td style={{ padding: "12px" }}>{item.journalRef}</td>
                <td style={{ padding: "12px", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(item.amount)}</td>
                <td style={{ padding: "12px" }}>
                  <span style={{ fontWeight: 600 }}>{(item.confidence * 100).toFixed(1)}%</span>
                  <div style={{ fontSize: 12, color: item.confidence >= 0.95 ? "#0f766e" : "#ca8a04" }}>
                    {item.confidence >= 0.95 ? "Auto-review ready" : "Needs manual confirmation"}
                  </div>
                </td>
                <td style={{ padding: "12px", fontSize: 12, color: "#475569" }}>{item.signalSummary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        style={{
          alignSelf: "flex-start",
          background: "#0f766e",
          color: "#f8fafc",
          padding: "10px 16px",
          borderRadius: 12,
          border: "none",
          fontWeight: 600,
          fontSize: 14,
        }}
        onClick={() => {
          setConfirmationMessage(null);
          setShowModal(true);
        }}
      >
        Apply suggested matches (≥0.95)
      </button>
      {confirmationMessage && (
        <div style={{ fontSize: 12, color: "#0f766e" }}>{confirmationMessage}</div>
      )}
      {showModal && (
        <Modal
          title="Review ML matches"
          confirmLabel="Apply advisory matches"
          onCancel={() => setShowModal(false)}
          onConfirm={() => {
            setConfirmationMessage(`Drafted ${eligible.length} journal links with ML assistance.`);
            setShowModal(false);
          }}
        >
          <p>
            The following matches meet the 0.95 confidence threshold. Confirm to draft the ledger links; nothing posts until you finalise
            them in the reconciliation workspace.
          </p>
          <ul style={{ marginTop: 12, paddingLeft: 18 }}>
            {eligible.map((item) => (
              <li key={item.id} style={{ marginBottom: 8 }}>
                <strong>{item.payee}</strong> → {item.journalRef} · {formatCurrency(item.amount)} · Confidence {(item.confidence * 100).toFixed(1)}%
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}

function buildSparklinePath(values: number[], width: number, height: number) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const scaleX = width / (values.length - 1 || 1);
  const scaleY = height / (max - min || 1);
  return values
    .map((value, index) => {
      const x = index * scaleX;
      const y = height - (value - min) * scaleY;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

function buildBandPath(upper: number[], lower: number[], width: number, height: number) {
  const combined = [...upper, ...lower];
  const max = Math.max(...combined);
  const min = Math.min(...combined);
  const scaleX = width / (upper.length - 1 || 1);
  const scaleY = height / (max - min || 1);
  const upperPath = upper
    .map((value, index) => {
      const x = index * scaleX;
      const y = height - (value - min) * scaleY;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  const lowerPath = lower
    .slice()
    .reverse()
    .map((value, index) => {
      const x = (lower.length - 1 - index) * scaleX;
      const y = height - (value - min) * scaleY;
      return `L${x},${y}`;
    })
    .join(" ");
  return `${upperPath} ${lowerPath} Z`;
}

function ForecastPanel() {
  const [planModal, setPlanModal] = useState<ForecastSeries | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const series = useMemo<ForecastSeries[]>(
    () => [
      {
        id: "cash",
        title: "Cash balance forecast",
      horizon: "Next 8 weeks",
      modelCard: "https://example.com/model-cards/cash-sweep",
      primary: [82, 94, 101, 96, 112, 118, 124, 137],
      lower: [74, 86, 89, 83, 97, 103, 111, 121],
      upper: [91, 105, 115, 109, 128, 134, 140, 154],
      intentSummary: "Create a sweep to move $45k from operating to investment once balance stays above $120k for 2 weeks.",
    },
    {
      id: "payroll",
      title: "Payroll obligations",
      horizon: "Quarter outlook",
      modelCard: "https://example.com/model-cards/payroll-forecast",
      primary: [38, 40, 46, 43, 49, 55, 58, 62],
      lower: [34, 36, 41, 38, 44, 49, 52, 55],
      upper: [42, 45, 50, 48, 55, 61, 65, 70],
      intentSummary: "Schedule an advisory check-in before PAYGW spike above $60k expected in week 8.",
      },
    ],
    [],
  );

  return (
    <section style={panelStyle} aria-labelledby="forecast-heading">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AdvisoryBadge />
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Forecasts</span>
          </div>
          <h2 id="forecast-heading" style={{ fontSize: 20, fontWeight: 600 }}>Forward-looking positions</h2>
          <p style={{ fontSize: 14, color: "#475569", maxWidth: 520 }}>
            Interval bands communicate volatility while ML sparklines surface the most likely trend. Use “Plan sweep” to convert
            recommendations into advisory tasks.
          </p>
        </div>
        <WhyLink href="https://example.com/model-cards/forecast-orchestrator" />
      </header>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {series.map((item) => {
          const width = 180;
          const height = 80;
          const sparkPath = buildSparklinePath(item.primary, width, height);
          const bandPath = buildBandPath(item.upper, item.lower, width, height);
          const lowerTerminal = item.lower[item.lower.length - 1];
          const upperTerminal = item.upper[item.upper.length - 1];
          return (
            <div key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#475569" }}>{item.horizon}</div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{item.title}</h3>
                </div>
                <Tooltip activator={<span style={{ fontSize: 12 }}>Confidence band</span>} content={<span>The shaded area represents the 80% prediction interval based on the latest ensemble run.</span>} />
              </div>
              <svg width={width} height={height} role="img" aria-label={`${item.title} sparkline`}>
                <path d={bandPath} fill="rgba(14, 165, 233, 0.18)" stroke="none" />
                <path d={sparkPath} fill="none" stroke="#0f766e" strokeWidth={2} strokeLinecap="round" />
              </svg>
              <div style={{ fontSize: 12, color: "#0f766e", fontWeight: 600 }}>
                Confidence window: {lowerTerminal.toFixed(0)}k – {upperTerminal.toFixed(0)}k
              </div>
              <div style={{ fontSize: 12, color: "#475569" }}>{item.intentSummary}</div>
              <button
                style={{
                  alignSelf: "flex-start",
                  background: "#0f172a",
                  color: "#f8fafc",
                  padding: "8px 14px",
                  borderRadius: 12,
                  border: "none",
                  fontWeight: 600,
                  fontSize: 13,
                }}
                onClick={() => {
                  setToast(null);
                  setPlanModal(item);
                }}
              >
                Plan sweep
              </button>
              <WhyLink href={item.modelCard} />
            </div>
          );
        })}
      </div>
      {planModal && (
        <Modal
          title="Create advisory intent"
          confirmLabel="Log intent"
          onCancel={() => setPlanModal(null)}
          onConfirm={() => {
            setToast(`Intent logged: ${planModal.intentSummary}`);
            setPlanModal(null);
          }}
        >
          <p>
            Confirm you want to add the “{planModal.title}” sweep to the advisory queue. The client owner will receive a planning task
            with the suggested trigger conditions.
          </p>
          <p style={{ marginTop: 12, fontWeight: 600 }}>{planModal.intentSummary}</p>
        </Modal>
      )}
      {toast && <div style={{ fontSize: 12, color: "#0f766e" }}>{toast}</div>}
    </section>
  );
}

function InvoiceIngestionPanel() {
  const [rows, setRows] = useState<InvoiceDraft[]>(() => [
    {
      id: "INV-901",
      vendor: "Northwind Supplies",
      description: "Inventory restock – October",
      glAccount: "1400-Inventory",
      amount: 5420.35,
      confidence: 0.96,
      status: "ready",
    },
    {
      id: "INV-905",
      vendor: "Metro Freight",
      description: "Freight surcharge",
      glAccount: "6100-Logistics",
      amount: 890.0,
      confidence: 0.93,
      status: "review",
    },
    {
      id: "INV-910",
      vendor: "Office Hub",
      description: "Quarterly software licenses",
      glAccount: "7200-Software",
      amount: 1260.5,
      confidence: 0.89,
      status: "review",
    },
  ]);
  const [showModal, setShowModal] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const handleChange = (id: string, field: keyof InvoiceDraft, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              [field]: field === "amount" ? Number(value) : value,
            }
          : row,
      ),
    );
  };

  const readyRows = rows.filter((row) => row.confidence >= 0.9);
  const totalValue = readyRows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <section style={panelStyle} aria-labelledby="invoice-heading">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AdvisoryBadge />
            <span style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>Invoice ingestion</span>
          </div>
          <h2 id="invoice-heading" style={{ fontSize: 20, fontWeight: 600 }}>Draft journal lines</h2>
          <p style={{ fontSize: 14, color: "#475569", maxWidth: 520 }}>
            ML extracts populate the preview table. Adjust coding inline, then apply to create draft journals in your accounting system.
          </p>
        </div>
        <WhyLink href="https://example.com/model-cards/invoice-extractor" />
      </header>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#475569" }}>
              {[
                "Invoice",
                "Vendor",
                "Description",
                "GL account",
                "Amount",
                "Confidence",
                "Status",
              ].map((heading) => (
                <th key={heading} style={{ padding: "10px 12px", borderBottom: "1px solid #e2e8f0", fontWeight: 600 }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderBottom: "1px solid #e2e8f0", background: "#fff" }}>
                <td style={{ padding: "12px" }}>{row.id}</td>
                <td style={{ padding: "12px" }}>{row.vendor}</td>
                <td style={{ padding: "12px" }}>{row.description}</td>
                <td style={{ padding: "12px" }}>
                  <input
                    value={row.glAccount}
                    onChange={(event) => handleChange(row.id, "glAccount", event.target.value)}
                    style={{
                      width: "100%",
                      border: "1px solid #cbd5f5",
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: 13,
                    }}
                  />
                </td>
                <td style={{ padding: "12px" }}>
                  <input
                    type="number"
                    value={row.amount}
                    onChange={(event) => handleChange(row.id, "amount", event.target.value)}
                    style={{
                      width: "100%",
                      border: "1px solid #cbd5f5",
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: 13,
                    }}
                  />
                </td>
                <td style={{ padding: "12px" }}>
                  <span style={{ fontWeight: 600 }}>{(row.confidence * 100).toFixed(1)}%</span>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Extraction confidence</div>
                </td>
                <td style={{ padding: "12px", color: row.status === "ready" ? "#0f766e" : "#b45309" }}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        style={{
          alignSelf: "flex-start",
          background: "#0f766e",
          color: "#f8fafc",
          padding: "10px 16px",
          borderRadius: 12,
          border: "none",
          fontWeight: 600,
          fontSize: 14,
        }}
        onClick={() => {
          setFlash(null);
          setShowModal(true);
        }}
      >
        Apply as draft journal lines
      </button>
      {flash && <div style={{ fontSize: 12, color: "#0f766e" }}>{flash}</div>}
      {showModal && (
        <Modal
          title="Confirm draft creation"
          confirmLabel="Create drafts"
          onCancel={() => setShowModal(false)}
          onConfirm={() => {
            setFlash(`Created ${readyRows.length} draft journals totalling ${formatCurrency(totalValue)}.`);
            setShowModal(false);
          }}
        >
          <p>
            You are about to create draft journal lines for {readyRows.length} invoices with confidence ≥ 0.90. Review the totals before
            continuing.
          </p>
          <p style={{ marginTop: 12, fontWeight: 600 }}>Draft total: {formatCurrency(totalValue)}</p>
        </Modal>
      )}
    </section>
  );
}

function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f1f5f9 0%, #e2e8f0 100%)",
        padding: "48px clamp(16px, 5vw, 72px)",
        fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#0f172a",
        display: "flex",
        flexDirection: "column",
        gap: 32,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>ML in the console</h1>
          <p style={{ margin: "8px 0 0", fontSize: 15, color: "#475569", maxWidth: 640 }}>
            Explainable, reversible, and measured – machine learning assists your workflows but never blocks human control.
          </p>
        </div>
        <div style={{ fontSize: 12, color: "#475569" }}>Confidence badges and explanations appear on every panel.</div>
      </header>
      <main style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <ReconQueuePanel />
        <BankMatchingPanel />
        <ForecastPanel />
        <InvoiceIngestionPanel />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
