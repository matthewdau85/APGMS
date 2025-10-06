import React, { useState } from "react";
import { useSettingsQuery } from "../api/hooks";
import { formatCurrencyFromCents, formatDate } from "../utils/format";

const tabs = [
  "Business Profile",
  "Accounts",
  "Payroll & Sales",
  "Automated Transfers",
  "Security",
  "Notifications",
];

export default function Settings() {
  const { data, isLoading } = useSettingsQuery();
  const [activeTab, setActiveTab] = useState(tabs[0]);

  if (isLoading || !data) {
    return (
      <div className="settings-card">
        <div className="skeleton skeleton-block" style={{ height: 28, marginBottom: 16 }} />
        <div className="skeleton skeleton-block" style={{ height: 200 }} />
      </div>
    );
  }

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
          <div style={{ background: "#f9f9f9", borderRadius: 12, padding: 24, maxWidth: 650 }}>
            <div style={{ marginBottom: 16 }}>
              <label>ABN:</label>
              <p>{data.profile.abn}</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Legal Name:</label>
              <p>{data.profile.legalName}</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Trading Name:</label>
              <p>{data.profile.tradingName}</p>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label>Contact Email:</label>
              <p>{data.profile.contacts.email}</p>
            </div>
            {data.profile.contacts.phone && (
              <div style={{ marginBottom: 16 }}>
                <label>Contact Phone:</label>
                <p>{data.profile.contacts.phone}</p>
              </div>
            )}
          </div>
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
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.name}</td>
                    <td>{account.bsb}</td>
                    <td>{account.accountNumber}</td>
                    <td>{account.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "Payroll & Sales" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Payroll Providers</h3>
            <ul>
              {data.payrollProviders.map((provider) => (
                <li key={provider}>{provider}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: 24 }}>Sales Channels</h3>
            <ul>
              {data.salesChannels.map((channel) => (
                <li key={channel}>{channel}</li>
              ))}
            </ul>
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
                </tr>
              </thead>
              <tbody>
                {data.transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.type}</td>
                    <td>{formatCurrencyFromCents(transfer.amountCents)}</td>
                    <td>{transfer.frequency}</td>
                    <td>{formatDate(transfer.nextRun)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "Security" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Security Settings</h3>
            <p>Two-factor authentication: {data.security.twoFactor ? "Enabled" : "Disabled"}</p>
            <p>SMS alerts on large payments: {data.security.smsAlerts ? "Enabled" : "Disabled"}</p>
          </div>
        )}

        {activeTab === "Notifications" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Notification Preferences</h3>
            <p>Email reminders for due dates: {data.notifications.emailReminders ? "On" : "Off"}</p>
            <p>SMS lodgment reminders: {data.notifications.smsLodgmentReminders ? "On" : "Off"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
