import React, { useState } from "react";
import { transferToOneWayAccount, TransferResponse } from "../utils/bankApi";

interface TransferStatus {
  type: "idle" | "pending" | "success" | "error";
  message?: string;
  paygwReceipt?: TransferResponse;
  gstReceipt?: TransferResponse;
}

export default function FundSecuring({ paygwDue, gstDue }: { paygwDue: number; gstDue: number }) {
  const [status, setStatus] = useState<TransferStatus>({ type: "idle" });

  async function secureFunds() {
    setStatus({ type: "pending", message: "Initiating secure transfers..." });
    try {
      const paygwReceipt = await transferToOneWayAccount(paygwDue, "businessRevenueAcc", "oneWayPaygwAcc", "PAYGW");
      setStatus({
        type: "pending",
        message: "PAYGW secured, securing GST...",
        paygwReceipt,
      });
      const gstReceipt = await transferToOneWayAccount(gstDue, "businessRevenueAcc", "oneWayGstAcc", "GST");
      setStatus({
        type: "success",
        message: "Funds secured in designated one-way accounts.",
        paygwReceipt,
        gstReceipt,
      });
    } catch (error: any) {
      setStatus({
        type: "error",
        message: error?.message || "Failed to secure funds.",
      });
    }
  }

  return (
    <div className="card">
      <h3>Secure Funds</h3>
      <button onClick={secureFunds} disabled={status.type === "pending"}>
        {status.type === "pending" ? "Securing..." : "Secure PAYGW & GST Funds"}
      </button>
      {status.message && <p className={`status status-${status.type}`}>{status.message}</p>}
      {status.type === "success" && (
        <ul className="status-details">
          {status.paygwReceipt && (
            <li>
              PAYGW receipt: <code>{status.paygwReceipt.bankReceiptHash}</code>
            </li>
          )}
          {status.gstReceipt && (
            <li>
              GST receipt: <code>{status.gstReceipt.bankReceiptHash}</code>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
