import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import { verifyFunds, initiateTransfer, submitSTPReport } from '../utils/bankApi';
import { calculatePenalties } from '../utils/penalties';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  const { basHistory, setBasHistory, auditLog, setAuditLog } = ctx;
  const [isProcessing, setIsProcessing] = useState(false);
  const totalDue = paygwDue + gstDue;

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
            penalties: calculatePenalties(7, totalDue)
          },
          ...basHistory
        ]);
        setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodgment failed: insufficient funds`, user: "Admin" }]);
        setIsProcessing(false);
        return;
      }
      await submitSTPReport({ paygw: paygwDue, gst: gstDue, period: new Date(), ratesVersion: ctx.ratesVersion.id });
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
      setAuditLog([...auditLog, { timestamp: Date.now(), action: `BAS Lodged: $${totalDue.toFixed(2)} (rates ${ctx.ratesVersion.id})`, user: "Admin" }]);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="card">
      <h2>BAS Lodgment</h2>
      <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '0.5rem' }}>
        Rates version {ctx.ratesVersion.name} (checksum {ctx.ratesVersion.checksum?.slice(0, 12)}…)
      </div>
      <div>PAYGW: ${paygwDue.toFixed(2)}</div>
      <div>GST: ${gstDue.toFixed(2)}</div>
      <div className="total">Total: ${totalDue.toFixed(2)}</div>
      <button onClick={handleLodgment} disabled={isProcessing}>
        {isProcessing ? "Processing..." : "Lodge BAS & Transfer Funds"}
      </button>
    </div>
  );
}
