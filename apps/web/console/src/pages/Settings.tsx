import { ReactNode } from "react";

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Console settings</h1>
        <p className="text-sm text-slate-600">Manage notifications, security controls, and preferences for the BAS console.</p>
      </header>
      <section className="grid gap-6 lg:grid-cols-2">
        <SettingsCard
          title="Notifications"
          description="Choose which operational signals to receive by email."
        >
          <fieldset className="space-y-3">
            <legend className="sr-only">Notification preferences</legend>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              BAS submissions
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              Queue escalations
            </label>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <input type="checkbox" defaultChecked className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              Audit anomalies
            </label>
          </fieldset>
        </SettingsCard>
        <SettingsCard title="Security" description="Enforce MFA and privileged actions for BAS operations.">
          <div className="space-y-4 text-sm text-slate-700">
            <label className="flex items-center justify-between">
              <span>Require MFA for dry-run</span>
              <input type="checkbox" className="h-4 w-8 rounded-full border-slate-300 bg-slate-200 focus:ring-blue-500" defaultChecked />
            </label>
            <label className="flex items-center justify-between">
              <span>Session timeout (minutes)</span>
              <input
                type="number"
                min={5}
                max={240}
                defaultValue={30}
                className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring focus:ring-blue-500/30"
              />
            </label>
          </div>
        </SettingsCard>
      </section>
    </div>
  );
}

function SettingsCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" aria-label={title}>
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-600">{description}</p>
      </header>
      {children}
    </section>
  );
}
