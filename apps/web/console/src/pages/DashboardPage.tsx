import React from "react";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  PageHeader,
  Skeleton,
} from "../ui";

const kpiRows = [
  { label: "Entities monitored", value: "128" },
  { label: "Exceptions", value: "6" },
  { label: "Tasks due", value: "14" },
];

const activity = [
  { id: "GST-24-Q4", owner: "Morgan Shaw", due: "14 Oct", status: "In review" },
  { id: "PAYG-24-Q4", owner: "Jamie Lee", due: "19 Oct", status: "Awaiting data" },
  { id: "IAS-24-Q4", owner: "Terry Wu", due: "22 Oct", status: "On track" },
];

export function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Monitor BAS status, reconciliation work, and evidence throughput across the portfolio."
        actions={<Button>New insight</Button>}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {kpiRows.map((item) => (
          <Card key={item.label} className="bg-card/80">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {item.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Active statements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            caption="Key filings and their current owners"
            columns={[
              { key: "id", header: "Statement" },
              { key: "owner", header: "Owner" },
              { key: "due", header: "Due" },
              { key: "status", header: "Status" },
            ]}
            data={activity}
          />
          <Banner tone="info">
            The next compliance window opens in 4 days. Prepare workloads now to avoid last-minute crunch.
          </Banner>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API Latency</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-44 w-full" />
            <p className="text-sm text-muted-foreground">
              Real-time performance metrics from the ingestion pipeline.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Normalization throughput</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-44 w-full" />
            <p className="text-sm text-muted-foreground">
              Volume of records processed across connected services in the last 24 hours.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
