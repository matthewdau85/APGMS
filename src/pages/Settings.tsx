import React, { useEffect, useState } from "react";

import { Skeleton } from "../components/Skeleton";
import { useConnections, useSaveSettingsMutation, useSettings } from "../api/hooks";

const tabs = ["Business Profile", "Integrations", "Security"] as const;

type Tab = (typeof tabs)[number];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>(tabs[0]);
  const { data: settings, isLoading } = useSettings();
  const saveSettings = useSaveSettingsMutation();
  const { data: connections } = useConnections();

  const [retentionMonths, setRetentionMonths] = useState(84);
  const [piiMask, setPiiMask] = useState(true);

  useEffect(() => {
    if (settings) {
      setRetentionMonths(settings.retentionMonths);
      setPiiMask(settings.piiMask);
    }
  }, [settings]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    saveSettings.mutate({ retentionMonths, piiMask });
  };

  return (
    <div className="settings-card">
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
            onSubmit={handleSubmit}
            style={{
              background: "#f9f9f9",
              borderRadius: 12,
              padding: 24,
              maxWidth: 480,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Data retention</h3>
            <p style={{ fontSize: 14, color: "#555" }}>
              Configure how long activity data stays accessible for compliance checks.
            </p>
            {isLoading ? (
              <Skeleton height={48} />
            ) : (
              <div style={{ marginBottom: 16 }}>
                <label>Retention months</label>
                <input
                  className="settings-input"
                  type="number"
                  min={6}
                  max={120}
                  value={retentionMonths}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setRetentionMonths(Number(event.target.value))
                  }
                />
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <label>
                <input
                  type="checkbox"
                  checked={piiMask}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setPiiMask(event.target.checked)
                  }
                  style={{ marginRight: 8 }}
                />
                Mask personally identifiable information in exports
              </label>
            </div>
            <button
              className="button"
              type="submit"
              disabled={saveSettings.isPending}
              style={{ opacity: saveSettings.isPending ? 0.7 : 1 }}
            >
              {saveSettings.isPending ? "Saving..." : "Save settings"}
            </button>
          </form>
        )}

        {activeTab === "Integrations" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Connected providers</h3>
            {!connections ? (
              <Skeleton height={120} />
            ) : connections.length === 0 ? (
              <p style={{ color: "#555" }}>No integrations connected yet. Start from the Integrations page.</p>
            ) : (
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th align="left">Provider</th>
                    <th align="left">Type</th>
                    <th align="left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map(conn => (
                    <tr key={conn.id}>
                      <td>{conn.provider}</td>
                      <td>{conn.type}</td>
                      <td>{conn.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "Security" && (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <h3>Security</h3>
            <p style={{ color: "#555", fontSize: 14 }}>
              API requests automatically include a bearer token when configured. Use your identity provider to manage session
              security.
            </p>
            <p style={{ color: "#555", fontSize: 14 }}>
              Each request emits an <code>X-Request-ID</code> header for traceability in the event of an audit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
