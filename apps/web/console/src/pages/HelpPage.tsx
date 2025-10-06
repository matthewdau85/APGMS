import React from "react";
import { Banner, Button, Card, CardContent, CardHeader, CardTitle, CodeBlock, PageHeader } from "../ui";

export function HelpPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Help center"
        description="Access guides, diagnostics, and ways to reach the APGMS success team."
        actions={<Button variant="outline">Contact support</Button>}
      />
      <Banner tone="info">
        Browse the knowledge base or raise a ticket with operations. Most issues are resolved within four business hours.
      </Banner>
      <Card>
        <CardHeader>
          <CardTitle>Support diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Include the output of the diagnostics command when opening a support ticket.
          </p>
          <CodeBlock
            language="bash"
            code={`pnpm --filter @apgms/console diagnostics`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
