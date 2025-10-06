import React from "react";
import { Banner, Button, Card, CardContent, CardHeader, CardTitle, DataTable, PageHeader } from "../ui";

const payments = [
  { id: "PMT-1087", entity: "APG Manufacturing", amount: "$84,210", due: "21 Oct", method: "BPAY" },
  { id: "PMT-1088", entity: "Omega Retail", amount: "$65,430", due: "22 Oct", method: "Direct debit" },
  { id: "PMT-1089", entity: "Delta Logistics", amount: "$12,780", due: "29 Oct", method: "Wire" },
];

export function PaymentsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Payments"
        description="Coordinate remittance obligations and confirm settlement across jurisdictions."
        actions={<Button>Schedule payment run</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Upcoming settlements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            caption="Remittance queue"
            data={payments}
            columns={[
              { key: "id", header: "Payment" },
              { key: "entity", header: "Entity" },
              { key: "amount", header: "Amount" },
              { key: "due", header: "Due" },
              { key: "method", header: "Method" },
            ]}
          />
          <Banner tone="success">
            All high-value transactions have been approved by treasury for this window.
          </Banner>
        </CardContent>
      </Card>
    </div>
  );
}
