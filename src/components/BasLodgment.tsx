import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import { verifyFunds, initiateTransfer, submitSTPReport } from '../utils/bankApi';
import { calculatePenalties } from '../utils/penalties';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const { basHistory, setBasHistory, auditLog, setAuditLog } = useContext(AppContext);
  const [isProcessing, setIsProcessing] = useState(false);

  async function handleLodgment() {
    setIsProcessing(true);
    try {
      const fundsOk = await verifyFunds(paygwDue, gstDue);
      if (!fundsOk) {
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
        setIsProcessing(false);
        return;
      }
      await submitSTPReport({ paygw: paygwDue, gst: gstDue, period: new Date() });
      await initiateTransfer(paygwDue, gstDue);
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
    </div>
  );
}
