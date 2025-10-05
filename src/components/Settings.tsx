import React, { useState } from "react";

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
  return (
    <div style={{
      background: "#fff",
      borderRadius: 20,
      boxShadow: "0 2px 14px #00205b0b",
      padding: 32,
      maxWidth: 900,
      margin: "40px auto"
    }}>
      <div className="tabs-row">
        {tabs.map(tab => (
          <div
            key={tab}
            className={`tab-item${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 30 }}>
        {activeTab === "Business Profile" && (
          <div>
            <div style={{
              background: "#f9f9f9",
              borderRadius: 12,
              padding: 24,
              maxWidth: 650
            }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>ABN:</label>
                <input className="settings-input" style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>Legal Name:</label>
                <input className="settings-input" style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>Trading Name:</label>
                <input className="settings-input" style={{ width: "100%" }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>Contact Email/Phone:</label>
                <input className="settings-input" style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        )}
        {activeTab !== "Business Profile" && (
          <div style={{
            padding: 36,
            color: "#888",
            fontSize: 18,
            textAlign: "center"
          }}>
            <em>Coming soon: {activeTab}</em>
          </div>
        )}
      </div>
    </div>
  );
}
