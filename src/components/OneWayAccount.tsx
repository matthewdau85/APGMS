import React, { useContext, useState } from "react";
import { AppContext } from "../context/AppContext";

export default function OneWayAccount() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  const { vaultBalance, setVaultBalance, businessBalance, setBusinessBalance, auditLog, setAuditLog } = ctx;
  const [amount, setAmount] = useState(0);

  const handleSecureFunds = () => {
    if (amount > 0 && amount <= businessBalance) {
      setBusinessBalance(businessBalance - amount);
      setVaultBalance(vaultBalance + amount);
      setAuditLog([...auditLog, { timestamp: Date.now(), action: `Secured $${amount} to Tax Vault`, user: "Admin" }]);
    }
  };

  return (
    <div className="card">
      <h2>Tax Vault (One Way Account)</h2>
      <p>Funds here are reserved for BAS, PAYGW, GST. Withdrawals are disabled.</p>
      <div><b>Vault Balance:</b> ${vaultBalance.toFixed(2)}</div>
      <div><b>Business Account:</b> ${businessBalance.toFixed(2)}</div>
      <input type="number" value={amount} onChange={e => setAmount(Number(e.target.value))} min={0} max={businessBalance} placeholder="Amount to secure" />
      <button onClick={handleSecureFunds}>Secure Funds</button>
    </div>
  );
}
