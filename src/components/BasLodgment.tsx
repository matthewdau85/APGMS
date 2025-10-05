import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import { verifyFunds, initiateTransfer, submitSTPReport } from '../utils/bankApi';
import { calculatePenalties } from '../utils/penalties';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const { basHistory, setBasHistory, auditLog, setAuditLog } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleLodgment() {
    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const totalDue = paygwDue + gstDue;

    try {
      const fundsCheck = await verifyFunds(paygwDue, gstDue);
      if (!fundsCheck.ok || (fundsCheck.availableCents ?? 0) < Math.round(totalDue * 100)) {
        const message = fundsCheck.error ?? 'Insufficient funds available for BAS lodgment';
        setBasHistory([
          {
            period: new Date(),
            paygwPaid: 0,
            gstPaid: 0,
            status: "Late",
            daysLate: 7,
            penalties: calculatePenalties(7, totalDue)
          },
          ...basHistory
        ]);
        setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodgment failed: ${message}`, user: "Admin" }]);
        setErrorMessage(message);
        return;
      }

      const stpResult = await submitSTPReport({ paygw: paygwDue, gst: gstDue, period: new Date().toISOString() });
      if (!stpResult.ok) {
        throw new Error(stpResult.error ?? 'STP submission failed');
      }

      const transferResult = await initiateTransfer(paygwDue, gstDue);
      if (!transferResult.ok) {
        throw new Error(transferResult.error ?? 'Transfer to ATO failed');
      }

      setBasHistory([
        {
          period: new Date(),
          paygwPaid: paygwDue,
          gstPaid: gstDue,
          status: "On Time",
          daysLate: 0,
          penalties: 0
        },
        ...basHistory
      ]);
      setAuditLog([
        ...auditLog,
        { timestamp: Date.now(), action: `BAS Lodged: $${totalDue}`, user: "Admin", detail: transferResult.transferId }
      ]);
      setSuccessMessage(`BAS lodged successfully. Receipt: ${transferResult.receiptReference ?? transferResult.transferId ?? 'pending'}`);
    } catch (error: any) {
      const message = error?.message ?? 'Failed to lodge BAS';
      setErrorMessage(message);
      setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodgment error: ${message}`, user: "Admin" }]);
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
      <button onClick={handleLodgment} disabled={isProcessing}>
        {isProcessing ? "Processing..." : "Lodge BAS & Transfer Funds"}
      </button>
      {errorMessage && (
        <p role="alert" className="text-red-600" style={{ marginTop: 12 }}>
          {errorMessage}
        </p>
      )}
      {successMessage && (
        <p role="status" className="text-green-600" style={{ marginTop: 12 }}>
          {successMessage}
        </p>
      )}
    </div>
  );
}
