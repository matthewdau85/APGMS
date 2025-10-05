import React, { useContext } from "react";
import { transferToOneWayAccount } from "../utils/bankApi";
import { AppContext } from "../context/AppContext";

export default function FundSecuring({ paygwDue, gstDue }: { paygwDue: number; gstDue: number }) {
  const { adapterModes, logAdapterEvent } = useContext(AppContext);

  async function secureFunds() {
    try {
      const paygw = await transferToOneWayAccount(paygwDue, "businessRevenueAcc", "oneWayPaygwAcc", {
        mode: adapterModes.bank,
        log: logAdapterEvent,
      });
      const gst = await transferToOneWayAccount(gstDue, "businessRevenueAcc", "oneWayGstAcc", {
        mode: adapterModes.bank,
        log: logAdapterEvent,
      });
      if (paygw.status === "OK" && gst.status === "OK") {
        alert("Funds secured in designated one-way accounts.");
      } else {
        alert("Bank adapter reported insufficiency while securing funds.");
      }
    } catch (err: any) {
      alert(`Bank adapter error: ${err?.message || err}`);
    }
  }
  return (
    <div className="card">
      <h3>Secure Funds</h3>
      <button onClick={secureFunds}>Secure PAYGW & GST Funds</button>
    </div>
  );
}
