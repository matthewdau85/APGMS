// components/PaymentsForm.tsx
import React from "react";
import { toast } from "react-hot-toast";

export function PaymentsForm() {
  const [abn, setAbn] = React.useState("12345678901");
  const [taxType, setTaxType] = React.useState("GST");
  const [periodId, setPeriodId] = React.useState("2025Q2");
  const [amountCents, setAmountCents] = React.useState<number>(2500); // positive = deposit
  const [status, setStatus] = React.useState<string>("");

  async function post(path: string, body: any) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        const message =
          (data && typeof data === "object" && (data.error || data.detail)) ||
          (typeof data === "string" && data) ||
          `Request failed (${response.status})`;
        throw new Error(message);
      }

      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      toast.error(message);
      throw error;
    }
  }

  async function onDeposit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting deposit…");
    const res = await post("/api/payments/deposit", {
      abn,
      taxType,
      periodId,
      amountCents: Math.abs(amountCents),
    });
    setStatus(`✅ Deposit ok. Ledger #${res.ledger_id}, balance ${res.balance_after_cents}`);
  }

  async function onRelease(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Submitting release…");
    const res = await post("/api/payments/release", {
      abn,
      taxType,
      periodId,
      amountCents: -Math.abs(amountCents), // negative
    });
    setStatus(`✅ Released. Transfer ${res.transfer_uuid}. Balance ${res.balance_after_cents}`);
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
      </div>

      <pre>{status}</pre>
    </form>
  );
}
