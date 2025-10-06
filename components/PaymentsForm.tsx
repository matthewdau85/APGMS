// components/PaymentsForm.tsx
import React from "react";

export function PaymentsForm() {
  const [abn, setAbn] = React.useState("12345678901");
  const [taxType, setTaxType] = React.useState("GST");
  const [periodId, setPeriodId] = React.useState("2025Q2");
  const [amountCents, setAmountCents] = React.useState<number>(2500); // positive = deposit
  const [rptHead, setRptHead] = React.useState("");
  const [rptToken, setRptToken] = React.useState("");
  const [status, setStatus] = React.useState<string>("");

  async function post(path: string, body: any, extraHeaders?: Record<string, string>) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Request failed");
    return data;
  }

  async function onDeposit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting deposit…");
    try {
      const res = await post("/api/payments/deposit", { abn, taxType, periodId, amountCents: Math.abs(amountCents) });
      setStatus(`✅ Deposit ok. Ledger #${res.ledger_id}, balance ${res.balance_after_cents}`);
    } catch (err: any) {
      // Show service 4xx messages from payments service:
      // e.g. "No active RPT for period", "RPT signature invalid / expired"
      setStatus(`❌ ${err.message}`);
    }
  }

  async function onRelease(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting release…");
    try {
      const headers: Record<string, string> = {};
      if (rptHead) headers["X-RPT-Head"] = rptHead.trim();
      if (rptToken) headers["X-RPT-Token"] = rptToken.trim();

      const res = await post(
        "/api/payments/release",
        {
          abn,
          taxType,
          periodId,
          amountCents: -Math.abs(amountCents), // negative
          rptHead: rptHead.trim() || undefined,
          rptToken: rptToken.trim() || undefined,
        },
        headers
      );
      setStatus(`✅ Released. Transfer ${res.transfer_uuid}. Balance ${res.balance_after_cents}`);
    } catch (err: any) {
      // Example messages:
      // "duplicate key … ux_owa_single_release_per_period"
      // "No active RPT for period"
      setStatus(`❌ ${err.message}`);
    }
  }

  return (
    <form className="stack" style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <input value={abn} onChange={e => setAbn(e.target.value)} placeholder="ABN" />
      <input value={taxType} onChange={e => setTaxType(e.target.value)} placeholder="Tax type (GST)" />
      <input value={periodId} onChange={e => setPeriodId(e.target.value)} placeholder="Period (e.g., 2025Q2)" />
      <input
        type="number"
        value={amountCents}
        onChange={e => setAmountCents(Number(e.target.value))}
        placeholder="Amount cents (positive for deposit)"
      />

      <input
        value={rptHead}
        onChange={e => setRptHead(e.target.value)}
        placeholder="RPT head (payload_sha256)"
      />
      <input
        value={rptToken}
        onChange={e => setRptToken(e.target.value)}
        placeholder="RPT token (base64 signature)"
      />

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDeposit}>Deposit</button>
        <button onClick={onRelease}>Pay ATO (release)</button>
      </div>

      <pre>{status}</pre>
    </form>
  );
}
