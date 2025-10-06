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
  "Advanced",
  "Operations"
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  // Mock business profile state
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com"
  });
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [reconResult, setReconResult] = useState<{ matched: any[]; unmatched: any[] } | null>(null);
  const [reconStatus, setReconStatus] = useState("");
  const [reconLoading, setReconLoading] = useState(false);

  const featureBanking = React.useMemo(() => {
    if (typeof process !== "undefined" && process.env && process.env.FEATURE_BANKING === "true") {
      return true;
    }
    if (typeof window !== "undefined") {
      const win = window as any;
      if (win.FEATURE_BANKING === true || win.FEATURE_BANKING === "true") {
        return true;
      }
    }
    return false;
  }, []);

  async function handleReconUpload(file: File | null) {
    if (!file) {
      setReconStatus("Select a reconciliation file");
      return;
    }
    setReconLoading(true);
    setReconStatus("Uploading reconciliation file…");
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/settlement/import", {
        method: "POST",
        headers: mfaCode ? { "X-MFA-Code": mfaCode } : undefined,
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Import failed");
      }
      setReconResult(data);
      setReconStatus(`Matched ${data.matched?.length || 0} rows; ${data.unmatched?.length || 0} unmatched.`);
    } catch (err: any) {
      setReconStatus(`❌ ${err.message}`);
    } finally {
      setReconLoading(false);
    }
  }

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
        {activeTab === "Operations" && (
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <h3>Operations - Reconciliation Import</h3>
            {featureBanking ? (
              <div className="card" style={{ padding: 16, borderRadius: 8, background: "#fafafa", border: "1px solid #ddd" }}>
                <p>
                  Upload the sandbox banking reconciliation export to mark settlements as paid and attach evidence bundles.
                </p>
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleReconUpload(fileInputRef.current?.files?.[0] ?? null);
                  }}
                  style={{ display: "grid", gap: 12 }}
                >
                  <input type="file" ref={fileInputRef} accept=".csv,.json,.xml" />
                  <input
                    placeholder="MFA code"
                    value={mfaCode}
                    onChange={e => setMfaCode(e.target.value)}
                  />
                  <button className="button" disabled={reconLoading} type="submit">
                    {reconLoading ? "Importing…" : "Import reconciliation"}
                  </button>
                </form>
                <p style={{ marginTop: 12 }}>{reconStatus}</p>
                {reconResult && (
                  <div style={{ display: "grid", gap: 16 }}>
                    <section>
                      <h4>Matched</h4>
                      {reconResult.matched?.length ? (
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Provider Ref</th>
                              <th>Statement Ref</th>
                              <th>Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconResult.matched.map((row: any, idx: number) => (
                              <tr key={`matched-${idx}`}>
                                <td>{row.providerRef}</td>
                                <td>{row.statementRef}</td>
                                <td>
                                  {row.period ? (
                                    <a
                                      href={`/api/evidence?abn=${encodeURIComponent(row.period.abn)}&taxType=${encodeURIComponent(row.period.taxType)}&periodId=${encodeURIComponent(row.period.periodId)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      View evidence
                                    </a>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p>No matches yet.</p>
                      )}
                    </section>
                    <section>
                      <h4>Unmatched</h4>
                      {reconResult.unmatched?.length ? (
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Provider Ref</th>
                              <th>Statement Ref</th>
                              <th>Amount (cents)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconResult.unmatched.map((row: any, idx: number) => (
                              <tr key={`unmatched-${idx}`}>
                                <td>{row.providerRef || "—"}</td>
                                <td>{row.statementRef || "—"}</td>
                                <td>{row.amountCents ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p>All rows matched.</p>
                      )}
                    </section>
                  </div>
                )}
              </div>
            ) : (
              <p>Banking features are disabled. Set FEATURE_BANKING=true to enable reconciliation tools.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
