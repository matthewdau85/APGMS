import React from "react";
import { toast } from "react-hot-toast";
import { transferToOneWayAccount } from "../utils/bankApi";

export default function FundSecuring({ paygwDue, gstDue }: { paygwDue: number; gstDue: number }) {
  async function secureFunds() {
    await transferToOneWayAccount(paygwDue, "businessRevenueAcc", "oneWayPaygwAcc");
    await transferToOneWayAccount(gstDue, "businessRevenueAcc", "oneWayGstAcc");
    toast.success("Funds secured in designated one-way accounts.");
  }
  return (
    <div className="card">
      <h3>Secure Funds</h3>
      <button onClick={secureFunds}>Secure PAYGW & GST Funds</button>
    </div>
  );
}
