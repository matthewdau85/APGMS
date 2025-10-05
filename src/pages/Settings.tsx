import React, { useEffect, useState } from "react";
import { useAppContext } from "../context/AppContext";
import { formatCurrencyFromCents } from "../hooks/usePeriodData";

const tabs = [
  "Business Profile",
  "Accounts",
  "Payroll & Sales",
  "Automated Transfers",
  "Security",
  "Compliance & Audit",
  "Customisation",
  "Notifications",
  "Advanced"
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const { query, summary, vaultBalanceCents, totals, ledger, isLoading, error, refresh } = useAppContext();
  const [profile, setProfile] = useState({
    abn: query.abn,
    name: "Demo Pty Ltd",
    trading: "APGMS Demo",
    contact: "info@example.com"
  });

  useEffect(() => {
    setProfile((prev) => ({
      ...prev,
      abn: query.abn,
    }));
  }, [query.abn]);

  return (
    <div className="settings-card">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-gray-500">Manage organisation details, accounts, and compliance notifications.</p>
        </div>
        <button className="button" onClick={refresh}>Refresh data</button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading live balances…</p>}
      {error && (
        <div className="text-red-600 text-sm font-medium" role="alert">
          Unable to load settings data: {error}
        </div>
      )}

      <div className="tabs-row">
        {tabs.map(tab => (
          <div
            key={tab}
            className={`tab-item${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
            tabIndex={0}
          >
            {tab}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30 }}>
        {activeTab === "Business Profile" && (
          <form
            style={{
              background: "#f9f9f9",
              borderRadius: 12,
              padding: 24,
              maxWidth: 650
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <label>ABN:</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.abn}
                onChange={e => setProfile({ ...profile, abn: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Legal Name:</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.name}
                onChange={e => setProfile({ ...profile, name: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Trading Name:</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.trading}
                onChange={e => setProfile({ ...profile, trading: e.target.value })}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Contact Email/Phone:</label>
              <input
                className="settings-input"
                style={{ width: "100%" }}
                value={profile.contact}
                onChange={e => setProfile({ ...profile, contact: e.target.value })}
              />
            </div>
            <div style={{
              background: "#fff",
              borderRadius: 10,
              padding: 16,
              marginTop: 12,
              fontSize: 14,
              color: "#333"
            }}>
              <p><strong>Current Period:</strong> {summary.lastBAS ?? query.periodId}</p>
              <p><strong>Next BAS Due:</strong> {summary.nextDue ?? "TBC"}</p>
              <p><strong>Outstanding Payments:</strong> {summary.outstandingAmounts[0] ?? "None"}</p>
            </div>
          </form>
        )}
        {activeTab === "Accounts" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Linked Accounts</h3>
            <table>
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>BSB</th>
                  <th>Account #</th>
                  <th>Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Main Business</td>
                  <td>123-456</td>
                  <td>11111111</td>
                  <td>Operating</td>
                  <td><button className="button" style={{ padding: "2px 14px", fontSize: 14 }}>Remove</button></td>
                </tr>
                <tr>
                  <td>PAYGW Saver</td>
                  <td>123-456</td>
                  <td>22222222</td>
                  <td>PAYGW Buffer</td>
                  <td><button className="button" style={{ padding: "2px 14px", fontSize: 14 }}>Remove</button></td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 18 }}>
              <p style={{ fontSize: 14, marginBottom: 8 }}>Vault balance: <strong>{formatCurrencyFromCents(vaultBalanceCents)}</strong></p>
              <p style={{ fontSize: 12, color: "#666" }}>Deposited this period: {formatCurrencyFromCents(totals.totalDepositsCents)} · Released: {formatCurrencyFromCents(totals.totalReleasesCents)}</p>
              <button className="button">Link New Account</button>
            </div>
          </div>
        )}
        {activeTab === "Payroll & Sales" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Payroll Providers</h3>
            <ul>
              <li>MYOB</li>
              <li>QuickBooks</li>
            </ul>
            <button className="button" style={{ marginTop: 10 }}>Add Provider</button>
            <h3 style={{ marginTop: 24 }}>Sales Channels</h3>
            <ul>
              <li>Vend</li>
              <li>Square</li>
            </ul>
            <button className="button" style={{ marginTop: 10 }}>Add Channel</button>
          </div>
        )}
        {activeTab === "Automated Transfers" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Scheduled Transfers</h3>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Frequency</th>
                  <th>Next Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>PAYGW</td>
                  <td>$1,000</td>
                  <td>Weekly</td>
                  <td>05/06/2025</td>
                  <td><button className="button" style={{ padding: "2px 14px", fontSize: 14 }}>Edit</button></td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 18 }}>
              <button className="button">Add Transfer</button>
            </div>
          </div>
        )}
        {activeTab === "Security" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Security Settings</h3>
            <label>
              <input type="checkbox" defaultChecked /> Two-factor authentication enabled
            </label>
            <br />
            <label>
              <input type="checkbox" /> SMS alerts on large payments
            </label>
          </div>
        )}
        {activeTab === "Compliance & Audit" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Period Ledger Activity</h3>
            <ul style={{ fontSize: 14, lineHeight: 1.6 }}>
              {ledger.slice(0, 5).map(entry => (
                <li key={entry.id}>
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'} · {entry.amount_cents >= 0 ? 'Deposit' : 'Release'} {formatCurrencyFromCents(Math.abs(entry.amount_cents))}
                </li>
              ))}
              {ledger.length === 0 && <li>No audit events recorded for this period.</li>}
            </ul>
            {summary.alerts.length > 0 && (
              <div style={{ marginTop: 16, background: '#fffbe6', borderRadius: 8, padding: 12, border: '1px solid #facc15' }}>
                <h4 style={{ marginBottom: 6 }}>Alerts</h4>
                <ul style={{ marginLeft: 18 }}>
                  {summary.alerts.map((alert, idx) => (
                    <li key={idx}>{alert}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {activeTab === "Customisation" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>App Theme</h3>
            <button className="button" style={{ marginRight: 10 }}>ATO Style</button>
            <button className="button" style={{ background: "#262626" }}>Dark</button>
          </div>
        )}
        {activeTab === "Notifications" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Notification Preferences</h3>
            <label>
              <input type="checkbox" defaultChecked /> Email reminders for due dates
            </label>
            <br />
            <label>
              <input type="checkbox" /> SMS notifications for lodgment
            </label>
          </div>
        )}
        {activeTab === "Advanced" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Export Data</h3>
            <button className="button">Export as CSV</button>
          </div>
        )}
      </div>
    </div>
  );
}
