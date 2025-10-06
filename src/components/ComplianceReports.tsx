import React from "react";
import { TaxReport } from "../types/tax";
import { EmptyState } from "../ui/states";

export default function ComplianceReports({ history }: { history: TaxReport[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No compliance reports yet"
        body="Once you lodge your first BAS we will keep the PAYGW, GST and total payable history here."
        ctaLabel="Generate first BAS report"
        onCta={() => {
          window.location.href = "/bas";
        }}
      />
    );
  }

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
