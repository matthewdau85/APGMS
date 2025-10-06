// components/PaymentsForm.tsx
import React from "react";

export function PaymentsForm() {
  const [abn, setAbn] = React.useState("12345678901");
  const [taxType, setTaxType] = React.useState("GST");
  const [periodId, setPeriodId] = React.useState("2025Q2");
  const [amountCents, setAmountCents] = React.useState<number>(2500); // positive = deposit
  const [status, setStatus] = React.useState<string>("");
  const [bsb, setBsb] = React.useState("123456");
  const [accountNumber, setAccountNumber] = React.useState("000123456");
  const [statementRef, setStatementRef] = React.useState("SANDBOXREF");

  const featureBanking = React.useMemo(() => {
    if (typeof process !== "undefined" && process.env && process.env.FEATURE_BANKING === "true") {
      return true;
    }
    if (typeof window !== "undefined") {
      const win = window as any;
      if (win.FEATURE_BANKING === true || win.FEATURE_BANKING === "true") {
        return true;
      }
    }
    return false;
  }, []);

  async function post(path: string, body: any) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      const res = await post("/api/payments/release", {
        abn,
        taxType,
        periodId,
        amountCents: -Math.abs(amountCents), // negative
      });
      setStatus(`✅ Released. Transfer ${res.transfer_uuid}. Balance ${res.balance_after_cents}`);
    } catch (err: any) {
      // Example messages:
      // "duplicate key … ux_owa_single_release_per_period"
      // "No active RPT for period"
      setStatus(`❌ ${err.message}`);
    }
  }

  async function onReleaseEft(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting EFT release…");
    try {
      const res = await post("/api/payments/release", {
        abn,
        taxType,
        periodId,
        amountCents: Math.abs(amountCents),
        destination: {
          bsb,
          accountNumber,
          statementRef,
        },
      });
      setStatus(`✅ EFT submitted. Settlement ${res.settlement_id}. Provider ref ${res.provider_ref || res.providerRef}.`);
    } catch (err: any) {
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

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onDeposit}>Deposit</button>
        <button onClick={onRelease}>Pay ATO (release)</button>
        {featureBanking ? (
          <button onClick={onReleaseEft}>Release via EFT (sandbox)</button>
        ) : null}
      </div>

      {featureBanking ? (
        <div style={{ display: "grid", gap: 8 }}>
          <input value={bsb} onChange={e => setBsb(e.target.value)} placeholder="BSB" />
          <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" />
          <input value={statementRef} onChange={e => setStatementRef(e.target.value)} placeholder="Statement reference" />
        </div>
      ) : null}

      <pre>{status}</pre>
    </form>
  );
}
