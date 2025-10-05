import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import { verifyFunds, initiateTransfer, submitSTPReport, RemittanceFailureReason } from '../utils/bankApi';
import { calculatePenalties } from '../utils/penalties';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const { setBasHistory, setAuditLog, setDiscrepancyAlerts } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackedDiscrepancies, setTrackedDiscrepancies] = useState<string[]>([]);

  const totalDue = paygwDue + gstDue;

  function recordDiscrepancy(reason: RemittanceFailureReason, message: string) {
    const entry = {
      timestamp: Date.now(),
      action: `BAS Lodgment blocked (${reason})`,
      user: "Admin",
      reason,
      detail: message,
    };
    setAuditLog((prev: any[]) => [...prev, entry]);
    setDiscrepancyAlerts((prev: string[]) => (prev.includes(message) ? prev : [...prev, message]));
    setTrackedDiscrepancies((prev) => (prev.includes(message) ? prev : [...prev, message]));
    setBasHistory((prev: any[]) => [
      {
        period: new Date(),
        paygwPaid: 0,
        gstPaid: 0,
        status: "Late",
        daysLate: 7,
        penalties: calculatePenalties(7, totalDue)
      },
      ...prev
    ]);
  }

  async function handleLodgment() {
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const fundsCheck = await verifyFunds(paygwDue, gstDue);
      if (!fundsCheck.ok) {
        const reason = fundsCheck.reason ?? "anomaly";
        const message = fundsCheck.message ?? "Payments service rejected the request.";
        recordDiscrepancy(reason, message);
        setErrorMessage(message);
        return;
      }
      await submitSTPReport({ paygw: paygwDue, gst: gstDue, period: new Date() });
      const transferResult = await initiateTransfer(paygwDue, gstDue);
      if (!transferResult.ok) {
        const reason = transferResult.reason ?? "anomaly";
        const message = transferResult.message ?? "Payments service rejected the release.";
        recordDiscrepancy(reason, message);
        setErrorMessage(message);
        return;
      }
      setBasHistory((prev: any[]) => [
        {
          period: new Date(),
          paygwPaid: paygwDue,
          gstPaid: gstDue,
          status: "On Time",
          daysLate: 0,
          penalties: 0
        },
        ...prev
      ]);
      setAuditLog((prev: any[]) => [
        ...prev,
        { timestamp: Date.now(), action: `BAS Lodged: $${(paygwDue + gstDue).toFixed(2)}`, user: "Admin" }
      ]);
      setDiscrepancyAlerts((prev: string[]) => prev.filter(alert => !trackedDiscrepancies.includes(alert)));
      setTrackedDiscrepancies([]);
      setErrorMessage(null);
    } catch (err: any) {
      const message = err instanceof Error ? err.message : String(err);
      recordDiscrepancy("anomaly", `Unexpected error: ${message}`);
      setErrorMessage(`Unexpected error: ${message}`);
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
      {errorMessage && (
        <div className="alert" style={{ marginTop: 12, padding: 12, background: "#fff4f4", color: "#a30000", borderRadius: 8 }}>
          {errorMessage}
        </div>
      )}
      <button onClick={handleLodgment} disabled={isProcessing}>
        {isProcessing ? "Processing..." : "Lodge BAS & Transfer Funds"}
      </button>
    </div>
  );
}
