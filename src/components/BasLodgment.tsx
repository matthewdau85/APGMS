import React from 'react';
import { useAppContext } from '../context/AppContext';
import { formatCurrencyFromCents } from '../hooks/usePeriodData';

export default function BasLodgment({ paygwDue, gstDue }: { paygwDue: number, gstDue: number }) {
  const { summary, vaultBalanceCents } = useAppContext();

  return (
    <div className="card">
      <h2>BAS Lodgment</h2>
      <div>PAYGW: ${paygwDue.toFixed(2)}</div>
      <div>GST: ${gstDue.toFixed(2)}</div>
      <div className="total">Total: ${(paygwDue + gstDue).toFixed(2)}</div>
      <p style={{ fontSize: 14, color: '#555' }}>
        Vault balance available: {formatCurrencyFromCents(vaultBalanceCents)}. {summary.paymentsUpToDate ? 'All liabilities are funded.' : 'Additional funding required before lodging.'}
      </p>
      <button className="button" disabled>
        Lodgments managed automatically
      </button>
    </div>
  );
}
