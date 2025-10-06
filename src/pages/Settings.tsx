import React, { useEffect, useState } from "react";

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
  // Mock business profile state
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com"
  });
  const [reconInputs, setReconInputs] = useState<any[]>([]);
  const [gateStates, setGateStates] = useState<any[]>([]);
  const [dlqEvents, setDlqEvents] = useState<any[]>([]);
  const [loadingDlq, setLoadingDlq] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshSimData() {
    try {
      const [inputsRes, gatesRes, dlqRes] = await Promise.all([
        fetch("/api/sim/recon-inputs"),
        fetch("/api/sim/gates"),
        fetch("/api/sim/dlq"),
      ]);
      const [inputsJson, gatesJson, dlqJson] = await Promise.all([
        inputsRes.json(),
        gatesRes.json(),
        dlqRes.json(),
      ]);
      setReconInputs(inputsJson.items || []);
      setGateStates(gatesJson.gates || []);
      setDlqEvents(dlqJson.events || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Unable to load simulation data");
    }
  }

  useEffect(() => {
    if (activeTab === "Advanced") {
      refreshSimData();
    }
  }, [activeTab]);

  async function retryDlq(id: string) {
    try {
      setLoadingDlq(true);
      setError(null);
      const res = await fetch(`/api/sim/dlq/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Retry failed");
      }
      await refreshSimData();
    } catch (err: any) {
      setError(err?.message || "Retry failed");
    } finally {
      setLoadingDlq(false);
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
          <div style={{ maxWidth: 780, margin: "0 auto" }}>
            <h3>Inbound Simulation & Recon</h3>
            <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
              Trigger inbound simulators via the CLI or <code>/api/sim</code> endpoints to populate reconciliation inputs.
            </p>
            {error && <div style={{ color: "#b00020", marginBottom: 12 }}>{error}</div>}
            <section style={{ marginBottom: 24 }}>
              <h4>Gate States</h4>
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Status</th>
                    <th>Reason</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {gateStates.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: 12 }}>No gate transitions yet.</td>
                    </tr>
                  )}
                  {gateStates.map((gate: any) => (
                    <tr key={gate.key}>
                      <td>{gate.key}</td>
                      <td style={{ color: gate.state === "RECON_OK" ? "#00716b" : "#b00020" }}>{gate.state}</td>
                      <td>{gate.reason || ""}</td>
                      <td>{new Date(gate.updatedAt || gate.receivedAt || Date.now()).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section style={{ marginBottom: 24 }}>
              <h4>Recon Inputs</h4>
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th>Source</th>
                    <th>Amount</th>
                    <th>Delta</th>
                    <th>Status</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {reconInputs.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: 12 }}>No recon inputs yet.</td>
                    </tr>
                  )}
                  {reconInputs.map((input: any) => (
                    <tr key={input.id}>
                      <td>{input.scenario}</td>
                      <td>{input.source}</td>
                      <td>${(input.amountCents / 100).toFixed(2)}</td>
                      <td>{(input.deltaCents / 100).toFixed(2)}</td>
                      <td style={{ color: input.status === "RECON_OK" ? "#00716b" : "#b00020" }}>{input.status}</td>
                      <td>{new Date(input.receivedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h4>Dead Letter Queue</h4>
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Source</th>
                    <th>Reason</th>
                    <th>Received</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {dlqEvents.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", padding: 12 }}>DLQ is empty 🎉</td>
                    </tr>
                  )}
                  {dlqEvents.map((event: any) => (
                    <tr key={event.id}>
                      <td>{event.id.slice(0, 8)}…</td>
                      <td>{event.source}</td>
                      <td>{event.reason}</td>
                      <td>{new Date(event.receivedAt).toLocaleString()}</td>
                      <td>
                        <button
                          className="button"
                          disabled={loadingDlq}
                          onClick={() => retryDlq(event.id)}
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
