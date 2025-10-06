import React from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Form, FormActions, FormField, Input, PageHeader } from "../ui";

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage workspace defaults, notification routing, and data retention."
      />
      <Card>
        <CardHeader>
          <CardTitle>Workspace profile</CardTitle>
        </CardHeader>
        <CardContent>
          <Form>
            <FormField id="workspace-name" label="Workspace name" description="Displayed to operators and in exports.">
              <Input id="workspace-name" defaultValue="APGMS Operations" />
            </FormField>
            <FormField id="timezone" label="Timezone">
              <Input id="timezone" defaultValue="Australia/Sydney" />
            </FormField>
            <FormField id="support-email" label="Support email">
              <Input id="support-email" type="email" defaultValue="ops@apgms.io" />
            </FormField>
            <FormActions>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
              <Button type="submit">Save changes</Button>
            </FormActions>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
