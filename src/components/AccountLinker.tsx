import React from "react";

export default function AccountLinker({ onLink }: { onLink: (from: string, to: string) => void }) {
  return (
    <div className="card">
      <h2>Link Accounts</h2>
      <button onClick={() => onLink("businessRevenueAcc", "oneWayPaygwAcc")}>
        Link Revenue → PAYGW Account
      </button>
      <button onClick={() => onLink("businessRevenueAcc", "oneWayGstAcc")}>
        Link Revenue → GST Account
      </button>
    </div>
  );
}
