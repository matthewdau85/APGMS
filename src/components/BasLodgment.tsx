import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import {
  verifyFunds,
  initiateTransfer,
  submitSTPReport,
  FundsVerificationResponse,
  SubmitStpResponse,
  TransferBundle,
} from '../utils/bankApi';
import { calculatePenalties } from '../utils/penalties';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const { basHistory, setBasHistory, auditLog, setAuditLog } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastTransfer, setLastTransfer] = useState<TransferBundle | null>(null);
  const [lastStp, setLastStp] = useState<SubmitStpResponse | null>(null);
  const [verification, setVerification] = useState<FundsVerificationResponse | null>(null);

  async function handleLodgment() {
    setIsProcessing(true);
    try {
      setStatus("Verifying funds availability...");
      const fundsCheck = await verifyFunds(paygwDue, gstDue);
      setVerification(fundsCheck);
      if (!fundsCheck.sufficient) {
        setBasHistory([
          {
            period: new Date(),
            paygwPaid: 0,
            gstPaid: 0,
            status: "Late",
            daysLate: 7,
            penalties: calculatePenalties(7, paygwDue + gstDue)
          },
          ...basHistory
        ]);
        setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodgment failed: insufficient funds`, user: "Admin" }]);
        setStatus("Insufficient funds available to cover PAYGW and GST liabilities.");
        setIsProcessing(false);
        return;
      }
      setStatus("Submitting STP report to ATO...");
      const stpResult = await submitSTPReport({
        paygwCents: Math.round(paygwDue * 100),
        gstCents: Math.round(gstDue * 100),
        period: new Date().toISOString(),
      });
      setLastStp(stpResult);

      setStatus("Initiating settlement transfer to One-Way Accounts...");
      const transferResult = await initiateTransfer(paygwDue, gstDue);
      setLastTransfer(transferResult);
      setStatus("BAS lodged successfully and funds secured.");
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
      setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodged: $${paygwDue + gstDue}`, user: "Admin" }]);
    } catch (error: any) {
      setStatus(error?.message || "Failed to lodge BAS.");
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
      {status && <p className="status-message">{status}</p>}
      {verification && (
        <p className="status-detail">
          Available balance: ${(verification.availableCents / 100).toFixed(2)} | Required:{" "}
          {(paygwDue + gstDue).toFixed(2)}
        </p>
      )}
      {lastStp && (
        <p className="status-detail">
          STP confirmation: <code>{lastStp.confirmationId}</code>
        </p>
      )}
      {lastTransfer && (
        <div className="status-detail">
          <div>
            PAYGW receipt: <code>{lastTransfer.paygw.bankReceiptHash}</code>
          </div>
          <div>
            GST receipt: <code>{lastTransfer.gst.bankReceiptHash}</code>
          </div>
        </div>
      )}
    </div>
  );
}
