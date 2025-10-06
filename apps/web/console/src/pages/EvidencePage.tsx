import React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, CodeBlock, EmptyState, PageHeader } from "../ui";
import { Inbox } from "lucide-react";

export function EvidencePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Evidence"
        description="Centralize supporting documentation and create audit-ready bundles."
        actions={<Button variant="outline">Upload files</Button>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Ingestion API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Automate evidence capture with the REST API. Attach metadata to link documents back to ledger activity.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -X POST https://api.apgms.io/evidence \\
  -H 'Authorization: Bearer <token>' \\
  -F file=@invoice.pdf \\
  -F entity=\"APG Manufacturing\"`}
          />
        </CardContent>
      </Card>
      <EmptyState
        icon={<Inbox className="h-12 w-12" aria-hidden="true" />}
        title="No evidence yet"
        description="Ingest data from SFTP, API, or manual upload to build a defensible audit trail."
        action={<Button>Connect source</Button>}
      />
    </div>
  );
}
