import React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, DataTable, EmptyState, PageHeader } from "../ui";
import { FileCheck } from "lucide-react";

const filings = [
  { id: "BAS-2024-Q3", entity: "APG Manufacturing", status: "Filed", lodged: "02 Oct" },
  { id: "BAS-2024-Q3", entity: "Omega Retail", status: "In review", lodged: "--" },
  { id: "BAS-2024-Q3", entity: "Delta Logistics", status: "Awaiting docs", lodged: "--" },
];

export function BasPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Business Activity Statements"
        description="Track BAS lifecycle from preparation through lodgement and review."
        actions={<Button>Generate BAS</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Current period</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Quarterly BAS workflows"
            columns={[
              { key: "id", header: "Reference" },
              { key: "entity", header: "Entity" },
              { key: "status", header: "Status" },
              { key: "lodged", header: "Lodged" },
            ]}
            data={filings}
            emptyState={
              <EmptyState
                icon={<FileCheck className="h-10 w-10" aria-hidden="true" />}
                title="No BAS records"
                description="Create a BAS to start tracking statutory milestones."
                action={<Button>New BAS</Button>}
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
