import React, { useContext, useMemo, useState } from "react";
import { AppContext, AppMode } from "../context/AppContext";

type FeatureDefinition = {
  key: string;
  label: string;
  description: string;
  category: string;
  variant?: "preview" | "dryRun";
};

type FeatureAuditEntry = {
  type: "feature" | "environment";
  flag?: string;
  value?: boolean;
  mode?: AppMode;
  previous?: AppMode;
  next?: AppMode;
  at: string;
  actor: string;
};

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
  "Features"
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const appContext = useContext(AppContext);
  // Mock business profile state
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com"
  });

  const {
    appMode,
    setAppMode,
    featureFlags,
    setFeatureFlags,
    auditLog,
    setAuditLog,
    ratesVersion,
    keyMetadata,
    ruleManifest,
  } = appContext;

  const featureDefinitions = useMemo<FeatureDefinition[]>(
    () => [
      {
        key: "FEATURE_SMART_ROUTING",
        label: "Smart routing",
        description: "Optimise payouts across connected rails using the risk engine.",
        category: "Core",
      },
      {
        key: "FEATURE_RISK_SCORING",
        label: "Risk scoring",
        description: "Enable fraud heuristics and behavioural risk adjustments in flight.",
        category: "Core",
      },
      {
        key: "FEATURE_SETTLEMENT_BATCHING",
        label: "Settlement batching",
        description: "Batch settlements to reduce fees at the cost of slightly delayed disbursements.",
        category: "Core",
      },
      {
        key: "FEATURE_SHADOW_SETTLEMENT",
        label: "Preview settlements (shadow)",
        description: "Mirrors live settlement plans into the shadow environment for validation before promoting to prod.",
        category: "Preview",
        variant: "preview" as const,
      },
      {
        key: "FEATURE_RULE_MANIFEST_SYNC",
        label: "Rule manifest sync",
        description: "Pull the latest manifest for GST and PAYGW orchestration rules.",
        category: "Operations",
      },
      {
        key: "DRY_RUN_PAYMENTS",
        label: "Payments dry run",
        description: "Execute orchestration without posting funds; emits audit-only events.",
        category: "Safety",
        variant: "dryRun" as const,
      },
      {
        key: "DRY_RUN_NOTIFICATIONS",
        label: "Notification dry run",
        description: "Suppress outbound notifications while still logging template resolution.",
        category: "Safety",
        variant: "dryRun" as const,
      },
    ],
    []
  );

  const modeMeta: Record<AppMode, { label: string; tone: string; description: string }> = {
    dev: {
      label: "Development",
      tone: "#2563eb",
      description: "Full control with hot reload and verbose logging.",
    },
    stage: {
      label: "Staging",
      tone: "#f59e0b",
      description: "Safe for rehearsals; feature flips propagate to shadow workloads.",
    },
    prod: {
      label: "Production",
      tone: "#16a34a",
      description: "Readonly. Changes require change window approval.",
    },
  };

  const canEditFeatures = appMode !== "prod";

  const featureAuditLog = useMemo(() => {
    return auditLog.filter((entry): entry is FeatureAuditEntry =>
      entry && (entry.type === "feature" || entry.type === "environment")
    );
  }, [auditLog]);

  const handleModeChange = (nextMode: AppMode) => {
    setAppMode(prevMode => {
      if (prevMode === nextMode) {
        return prevMode;
      }

      setAuditLog(prev => [
        ...prev,
        {
          type: "environment",
          previous: prevMode,
          next: nextMode,
          at: new Date().toISOString(),
          actor: "ops-console",
        },
      ]);

      return nextMode;
    });
  };

  const handleToggle = (key: string) => {
    if (!canEditFeatures) {
      return;
    }

    setFeatureFlags(prevFlags => {
      const updated = { ...prevFlags, [key]: !prevFlags[key] };
      setAuditLog(prev => [
        ...prev,
        {
          type: "feature",
          flag: key,
          value: updated[key],
          mode: appMode,
          at: new Date().toISOString(),
          actor: "ops-console",
        },
      ]);
      return updated;
    });
  };

  const featuresByCategory = useMemo(() => {
    return featureDefinitions.reduce<Record<string, FeatureDefinition[]>>((acc, feature) => {
      const bucket = acc[feature.category] ?? [];
      bucket.push(feature);
      acc[feature.category] = bucket;
      return acc;
    }, {});
  }, [featureDefinitions]);

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
            <h3>Audit Log (Mock)</h3>
            <ul>
              <li>05/06/2025 - PAYGW transfer scheduled</li>
              <li>29/05/2025 - BAS submitted</li>
            </ul>
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
        {activeTab === "Features" && (
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <section
              style={{
                background: "#f9fafb",
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
                border: "1px solid #e5e7eb",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ marginBottom: 6 }}>Environment mode</h3>
                  <p style={{ margin: 0, color: "#4b5563" }}>APP_MODE: {modeMeta[appMode].label}</p>
                  <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{modeMeta[appMode].description}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Switch mode</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {(Object.keys(modeMeta) as AppMode[]).map(mode => (
                      <button
                        key={mode}
                        className="button"
                        style={{
                          background: mode === appMode ? modeMeta[mode].tone : "#111827",
                          borderColor: mode === appMode ? modeMeta[mode].tone : "#111827",
                          opacity: mode === appMode ? 1 : 0.6,
                          cursor: mode === appMode ? "default" : "pointer",
                        }}
                        onClick={() => handleModeChange(mode)}
                        type="button"
                      >
                        {modeMeta[mode].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {!canEditFeatures && (
                <div
                  style={{
                    marginTop: 16,
                    padding: 12,
                    borderRadius: 8,
                    background: "#fef3c7",
                    border: "1px solid #f59e0b",
                    color: "#92400e",
                    fontSize: 14,
                  }}
                >
                  Production mode detected. Feature flips are locked; raise a change request to update.
                </div>
              )}
            </section>

            <section style={{ marginBottom: 24 }}>
              <h3 style={{ marginBottom: 12 }}>Feature flags</h3>
              {Object.entries(featuresByCategory).map(([category, items]) => (
                <div
                  key={category}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    marginBottom: 16,
                    background: "white",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid #e5e7eb",
                      fontWeight: 600,
                      background: "#f9fafb",
                    }}
                  >
                    {category}
                  </div>
                  <div>
                    {items.map(item => {
                      const isEnabled = featureFlags[item.key];
                      return (
                        <div
                          key={item.key}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "14px 16px",
                            borderBottom: "1px solid #f3f4f6",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ maxWidth: "70%" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 600 }}>{item.label}</span>
                              {item.variant === "preview" && (
                                <span
                                  style={{
                                    background: "#dbeafe",
                                    color: "#1d4ed8",
                                    fontSize: 12,
                                    padding: "2px 8px",
                                    borderRadius: 9999,
                                  }}
                                >
                                  Preview / shadow
                                </span>
                              )}
                              {item.variant === "dryRun" && (
                                <span
                                  style={{
                                    background: "#fee2e2",
                                    color: "#b91c1c",
                                    fontSize: 12,
                                    padding: "2px 8px",
                                    borderRadius: 9999,
                                  }}
                                >
                                  Dry run
                                </span>
                              )}
                            </div>
                            <p style={{ margin: "6px 0 0", color: "#4b5563", fontSize: 14 }}>{item.description}</p>
                            {item.variant === "preview" && (
                              <p style={{ margin: "6px 0 0", color: "#2563eb", fontSize: 13 }}>
                                Shadow flips don't impact production traffic until promoted.
                              </p>
                            )}
                            {item.variant === "dryRun" && (
                              <p style={{ margin: "6px 0 0", color: "#b91c1c", fontSize: 13 }}>
                                Dry run skips side-effects. Confirm with operations before enabling in prod.
                              </p>
                            )}
                          </div>
                          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 13, color: "#6b7280" }}>{isEnabled ? "On" : "Off"}</span>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => handleToggle(item.key)}
                              disabled={!canEditFeatures}
                              style={{ width: 22, height: 22 }}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  background: "white",
                }}
              >
                <h4 style={{ margin: 0, fontSize: 16 }}>Rates</h4>
                <p style={{ margin: "8px 0 0", color: "#4b5563", fontSize: 14 }}>RATES_VERSION</p>
                <p style={{ margin: "4px 0 0", fontWeight: 600 }}>{ratesVersion}</p>
                <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 13 }}>
                  Managed via revenue service release train. Read-only from console.
                </p>
              </div>
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  background: "white",
                }}
              >
                <h4 style={{ margin: 0, fontSize: 16 }}>Key material</h4>
                <p style={{ margin: "8px 0 12px", color: "#4b5563", fontSize: 14 }}>Active KIDs</p>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {keyMetadata.map(key => (
                    <li key={key.kid} style={{ marginBottom: 6, color: "#374151", fontSize: 14 }}>
                      <div style={{ fontWeight: 600 }}>{key.kid}</div>
                      <div style={{ color: "#6b7280", fontSize: 13 }}>{key.purpose}</div>
                      <div style={{ color: "#6b7280", fontSize: 12 }}>Rotation due {key.rotationDue}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  background: "white",
                }}
              >
                <h4 style={{ margin: 0, fontSize: 16 }}>Rule manifest</h4>
                <p style={{ margin: "8px 0 0", color: "#4b5563", fontSize: 14 }}>{ruleManifest.id}</p>
                <p style={{ margin: "4px 0 0", fontWeight: 600 }}>Revision {ruleManifest.revision}</p>
                <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>
                  Published {new Date(ruleManifest.publishedAt).toLocaleString()} (checksum {ruleManifest.checksum})
                </p>
                {ruleManifest.notes && (
                  <p style={{ margin: "8px 0 0", color: "#4b5563", fontSize: 13 }}>{ruleManifest.notes}</p>
                )}
              </div>
            </section>

            <section
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 16,
                background: "#f9fafb",
                color: "#374151",
                fontSize: 13,
              }}
            >
              <h4 style={{ margin: "0 0 8px" }}>Last 3 console events</h4>
              {featureAuditLog.length === 0 && (
                <p style={{ margin: 0, color: "#6b7280" }}>No feature flips recorded yet.</p>
              )}
              {featureAuditLog.slice(-3).reverse().map((entry, index) => (
                <div key={index} style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600 }}>
                    {entry.type === "feature" && `${entry.flag} → ${entry.value ? "on" : "off"}`}
                    {entry.type === "environment" && `Mode ${entry.previous} → ${entry.next}`}
                  </div>
                  <div style={{ color: "#6b7280" }}>
                    {new Date(entry.at).toLocaleString()} • {entry.actor}
                  </div>
                  {entry.mode && <div style={{ color: "#6b7280" }}>Mode snapshot: {entry.mode}</div>}
                </div>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
