import React, { useContext, useState } from "react";
import { AppContext } from "../context/AppContext";

async function closeAndIssuePeriod(params: { abn: string; taxType: string; periodId: string }) {
  const res = await fetch(`/api/periods/${params.periodId}/close-and-issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abn: params.abn, taxType: params.taxType }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || err?.state || "CLOSE_FAILED");
  }
  return res.json();
}

async function releasePayment(params: { abn: string; taxType: string; periodId: string; amountCents: number }) {
  const res = await fetch("/api/payments/release", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      amountCents: params.amountCents,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || "RELEASE_FAILED");
  }
  return res.json();
}

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number; gstDue: number }) {
  const { basHistory, setBasHistory, auditLog, setAuditLog } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLodgment() {
    setIsProcessing(true);
    setError(null);
    const abn = "12345678901";
    const taxType = "GST";
    const periodId = new Date().toISOString().slice(0, 7); // YYYY-MM
    try {
      const rpt = await closeAndIssuePeriod({ abn, taxType, periodId });
      const amount = Number(rpt?.payload?.amount_cents ?? 0);
      await releasePayment({ abn, taxType, periodId, amountCents: -Math.abs(amount) });
      setBasHistory([
        {
          period: new Date(),
          paygwPaid: paygwDue,
          gstPaid: gstDue,
          status: "On Time",
          daysLate: 0,
          penalties: 0,
        },
        ...basHistory,
      ]);
      setAuditLog([
        ...auditLog,
        { timestamp: Date.now(), action: `BAS Lodged: $${(paygwDue + gstDue).toFixed(2)}`, user: "Admin" },
      ]);
    } catch (e: any) {
      setError(e?.message || "Lodgment failed");
      setAuditLog([
        ...auditLog,
        { timestamp: Date.now(), action: `BAS Lodgment failed: ${e?.message || "unknown"}`, user: "Admin" },
      ]);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="card">
      <h2>BAS Lodgment</h2>
      <div>PAYGW: ${paygwDue.toFixed(2)}</div>
      <div>GST: ${gstDue.toFixed(2)}</div>
      <div className="total">Total: ${(paygwDue + gstDue).toFixed(2)}</div>
      {error && <div className="error">{error}</div>}
      <button onClick={handleLodgment} disabled={isProcessing}>
        {isProcessing ? "Processing..." : "Lodge BAS & Transfer Funds"}
      </button>
    </div>
  );
}
