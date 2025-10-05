import React, { useContext, useState } from "react";
import { AppContext } from "../context/AppContext";

function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export default function OneWayAccount() {
  const {
    query,
    balance,
    balanceLoading,
    balanceError,
    refreshBalance,
    auditLog,
    setAuditLog,
  } = useContext(AppContext);
  const [amount, setAmount] = useState<number>(0);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const vaultBalanceCents = balance?.balance_cents ?? 0;

  async function handleSecureFunds() {
    if (!amount || Number.isNaN(amount) || amount <= 0) {
      setStatus("Enter an amount greater than zero.");
      return;
    }

    setSubmitting(true);
    setStatus("Submitting deposit…");
    try {
      const res = await fetch("/api/payments/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          abn: query.abn,
          taxType: query.taxType,
          periodId: query.periodId,
          amountCents: Math.round(amount * 100),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || res.statusText || "Deposit failed";
        throw new Error(message);
      }
      setStatus(
        `Secured ${formatCurrencyFromCents(Math.round(amount * 100))}. Ledger balance ${formatCurrencyFromCents(
          payload?.balance_after_cents ?? 0,
        )}`,
      );
      setAuditLog([
        ...auditLog,
        {
          timestamp: Date.now(),
          action: `Secured ${formatCurrencyFromCents(Math.round(amount * 100))} to Tax Vault`,
          user: "Admin",
        },
      ]);
      await refreshBalance();
      setAmount(0);
    } catch (err: any) {
      setStatus(err?.message || "Failed to secure funds");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <h2>Tax Vault (One Way Account)</h2>
      <p>Funds here are reserved for BAS, PAYGW, GST. Withdrawals are disabled.</p>
      <div>
        <b>Vault Balance:</b> {balanceLoading ? "Loading…" : formatCurrencyFromCents(vaultBalanceCents)}
      </div>
      {balanceError && (
        <div className="text-sm text-red-600 mt-1">{balanceError}</div>
      )}
      <label className="block mt-3 text-sm font-medium text-gray-700">
        Amount to secure
        <input
          type="number"
          value={Number.isNaN(amount) ? "" : amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          min={0}
          step="0.01"
          className="mt-1 w-full border rounded px-2 py-1"
          placeholder="Enter amount in AUD"
        />
      </label>
      <button onClick={handleSecureFunds} disabled={submitting} className="mt-3">
        {submitting ? "Processing…" : "Secure Funds"}
      </button>
      {status && <p className="mt-2 text-sm text-gray-600">{status}</p>}
    </div>
  );
}
