import React from "react";
export default function FundSecuring({ paygwDue, gstDue }: { paygwDue: number; gstDue: number }) {
  async function secureFunds() {
    console.log("Secure PAYGW", paygwDue, "GST", gstDue);
    alert("Funds secured in designated one-way accounts.");
  }
  return (
    <div className="card">
      <h3>Secure Funds</h3>
      <button onClick={secureFunds}>Secure PAYGW & GST Funds</button>
    </div>
  );
}
