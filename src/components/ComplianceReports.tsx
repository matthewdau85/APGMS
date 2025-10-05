import React from "react";
import { TaxReport } from "../types/tax";

export default function ComplianceReports({ history }: { history: TaxReport[] }) {
  return (
    <div className="card">
      <h3>Compliance Reports</h3>
      <ul>
        {history.map((rep, i) => (
          <li key={i}>
            PAYGW: ${rep.paygwLiability.toFixed(2)} | GST: ${rep.gstPayable.toFixed(2)} | Total: ${rep.totalPayable.toFixed(2)}
            | Status: {rep.complianceStatus}
          </li>
        ))}
      </ul>
    </div>
  );
}
