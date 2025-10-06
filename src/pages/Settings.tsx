import React, { useState } from "react";
import {
  useBusinessProfile,
  useConnections,
  useSettings,
  useTransactions,
  useBalance,
} from "../hooks/useConsoleData";

const tabs = [
  "Business Profile",
  "Accounts",
  "Payroll & Sales",
  "Automated Transfers",
  "Security",
  "Compliance & Audit",
  "Customisation",
  "Notifications",
  "Advanced",
];

function formatDate(epoch?: number) {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

function formatCurrency(cents?: number) {
  if (typeof cents !== "number") return "—";
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const profileQuery = useBusinessProfile();
  const connectionsQuery = useConnections();
  const settingsQuery = useSettings();
  const transactionsQuery = useTransactions();
  const balanceQuery = useBalance();

  const profile = profileQuery.data;
  const settings = settingsQuery.data;

  return (
    <div className="settings-card">
      <div className="tabs-row">
        {tabs.map((tab) => (
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
          <div
            style={{
              background: "#f9f9f9",
              borderRadius: 12,
              padding: 24,
              maxWidth: 650,
            }}
          >
            <div style={{ marginBottom: 16 }}>
              <label>ABN:</label>
              {profileQuery.isLoading ? (
                <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: 7 }} />
              ) : (
                <input className="settings-input" style={{ width: "100%" }} value={profile?.abn ?? ""} readOnly />
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Legal Name:</label>
              {profileQuery.isLoading ? (
                <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: 7 }} />
              ) : (
                <input className="settings-input" style={{ width: "100%" }} value={profile?.name ?? ""} readOnly />
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Trading Name:</label>
              {profileQuery.isLoading ? (
                <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: 7 }} />
              ) : (
                <input className="settings-input" style={{ width: "100%" }} value={profile?.trading ?? ""} readOnly />
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Contact Email/Phone:</label>
              {profileQuery.isLoading ? (
                <div className="skeleton" style={{ height: 36, width: "100%", borderRadius: 7 }} />
              ) : (
                <input className="settings-input" style={{ width: "100%" }} value={profile?.contact ?? ""} readOnly />
              )}
            </div>
            <p style={{ fontSize: 13, color: "#555" }}>
              Profile data reflects the latest information registered with the console API.
            </p>
          </div>
        )}
        {activeTab === "Accounts" && (
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <h3>Linked Accounts</h3>
            {connectionsQuery.isLoading ? (
              <div className="skeleton" style={{ height: 160, width: "100%" }} />
            ) : connectionsQuery.data && connectionsQuery.data.length ? (
              <table>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>State</th>
                    <th>Linked</th>
                  </tr>
                </thead>
                <tbody>
                  {connectionsQuery.data.map((conn) => (
                    <tr key={`${conn.provider}-${conn.id ?? "new"}`}>
                      <td>{conn.provider}</td>
                      <td>{conn.type}</td>
                      <td>{conn.state ?? "Pending"}</td>
                      <td>{formatDate(conn.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p style={{ marginTop: 12 }}>No bank or payroll accounts linked yet.</p>
            )}
          </div>
        )}
        {activeTab === "Payroll & Sales" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Connected Data Sources</h3>
            {transactionsQuery.isLoading ? (
              <div className="skeleton" style={{ height: 120, width: "100%" }} />
            ) : transactionsQuery.data ? (
              <>
                <p>Active sources detected:</p>
                <ul>
                  {transactionsQuery.data.sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
                <p style={{ marginTop: 12 }}>
                  Recent transactions: {transactionsQuery.data.items.length} ingested from the connected feeds.
                </p>
              </>
            ) : (
              <p>No transactions ingested yet.</p>
            )}
          </div>
        )}
        {activeTab === "Automated Transfers" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Vault Position</h3>
            {balanceQuery.isLoading ? (
              <div className="skeleton" style={{ height: 120, width: "100%" }} />
            ) : balanceQuery.data ? (
              <>
                <p>
                  Balance for current period: <strong>{formatCurrency(balanceQuery.data.balance_cents)}</strong>
                </p>
                <p>Status: {balanceQuery.data.has_release ? "Release completed" : "Awaiting release"}</p>
              </>
            ) : (
              <p>Unable to determine vault position.</p>
            )}
          </div>
        )}
        {activeTab === "Security" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Security Settings</h3>
            {settingsQuery.isLoading ? (
              <div className="skeleton" style={{ height: 60, width: "100%" }} />
            ) : (
              <ul>
                <li>Retention: {settings?.retentionMonths ?? "—"} months</li>
                <li>PII Masking Enabled: {settings?.piiMask ? "Yes" : "No"}</li>
              </ul>
            )}
          </div>
        )}
        {activeTab === "Compliance & Audit" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Compliance Snapshot</h3>
            {balanceQuery.isLoading ? (
              <div className="skeleton" style={{ height: 60, width: "100%" }} />
            ) : (
              <>
                <p>
                  Outstanding balance: <strong>{formatCurrency(balanceQuery.data?.balance_cents)}</strong>
                </p>
                <p>Last release processed: {balanceQuery.data?.has_release ? "Yes" : "No"}</p>
              </>
            )}
          </div>
        )}
        {activeTab === "Customisation" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>App Theme</h3>
            <p>Theme changes will be available once custom branding endpoints are live.</p>
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
