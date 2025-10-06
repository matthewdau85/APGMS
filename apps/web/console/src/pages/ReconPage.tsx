import React from "react";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Copyable,
  DataTable,
  PageHeader,
  Spinner,
} from "../ui";

const breaks = [
  { id: "INV-8721", variance: "$1,240", owner: "Kira Patel", status: "Investigating" },
  { id: "INV-8729", variance: "$540", owner: "Sam Jones", status: "Ready to post" },
];

export function ReconPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reconciliation"
        description="Resolve ledger variances with automated evidence and workflow visibility."
        actions={<Button variant="outline">Export report</Button>}
      />
      <Banner tone="warning">
        The bank feed for Westpac stalled 14 minutes ago. Normalizer is retrying and will alert if manual action is required.
      </Banner>
      <Card>
        <CardHeader>
          <CardTitle>Breaks requiring action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            caption="Reconciling items grouped by workflow owner"
            data={breaks}
            columns={[
              { key: "id", header: "Break" },
              { key: "variance", header: "Variance" },
              { key: "owner", header: "Owner" },
              { key: "status", header: "Status" },
            ]}
          />
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Spinner /> Fetching additional bank lines...
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Automation webhooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Integrate reconciliation events into your incident and notification stack.
          </p>
          <Copyable label="Endpoint" value="https://api.apgms.io/hooks/recon/42ff1" />
        </CardContent>
      </Card>
    </div>
  );
}
