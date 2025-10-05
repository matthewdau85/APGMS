import React, { useState } from 'react';
import { PaymentPlanType } from '../types/tax';
import { useAppContext } from '../context/AppContext';

export default function PaymentPlanComponent() {
  const { summary } = useAppContext();
  const [plan, setPlan] = useState<PaymentPlanType>({
    totalAmount: 0,
    installments: 1,
    frequency: "monthly",
    startDate: new Date(),
    atoApproved: false
  });

  const handleSubmit = () => {
    const submittedPlan = { ...plan, atoApproved: Math.random() > 0.2 };
    alert(
      submittedPlan.atoApproved
        ? "Payment plan approved by ATO!"
        : "Payment plan rejected. Please contact ATO."
    );
  };

  return (
    <div className="card">
      <h2>ATO Payment Plan Negotiation</h2>
      <p style={{ fontSize: 14, color: '#555' }}>
        Current compliance score: {summary.overallCompliance}% — customise a plan if you need extra time to resolve outstanding balances.
      </p>
      <label>
        Total Amount Owing:
        <input type="number" value={plan.totalAmount} onChange={e => setPlan({ ...plan, totalAmount: Number(e.target.value) })} />
      </label>
      <label>
        Number of Installments:
        <input type="number" min="1" max="24" value={plan.installments} onChange={e => setPlan({ ...plan, installments: Number(e.target.value) })} />
      </label>
      <label>
        Payment Frequency:
        <select value={plan.frequency} onChange={e => setPlan({ ...plan, frequency: e.target.value as any })}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label>
        Start Date:
        <input type="date" value={plan.startDate.toISOString().split('T')[0]} onChange={e => setPlan({ ...plan, startDate: new Date(e.target.value) })} />
      </label>
      <button onClick={handleSubmit}>Submit to ATO</button>
    </div>
  );
}
