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
} from "../ui";

const access = [
  { email: "ops.lead@apgms.io", role: "Owner", lastSeen: "Just now" },
  { email: "finance.controller@apgms.io", role: "Admin", lastSeen: "2h ago" },
  { email: "external.auditor@firm.com", role: "Read only", lastSeen: "1d ago" },
];

export function AdminPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin console"
        description="Provision access, manage environments, and view audit information."
        actions={<Button>Invite teammate</Button>}
      />
      <Banner tone="error">
        MFA enforcement is off. Enable it to meet SOC2 and ISO27001 control requirements.
      </Banner>
      <Card>
        <CardHeader>
          <CardTitle>Access management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DataTable
            caption="Team permissions"
            data={access}
            columns={[
              { key: "email", header: "User" },
              { key: "role", header: "Role" },
              { key: "lastSeen", header: "Last active" },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>API credentials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Copyable label="Client ID" value="apgms_console_9c21" />
          <Copyable label="Client Secret" value="••••••••••" />
        </CardContent>
      </Card>
    </div>
  );
}
