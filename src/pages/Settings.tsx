import React, { useEffect, useState } from "react";
import { fetchSecurityConfig, toggleEncryption, toggleMfa, SecurityConfig } from "../api/security";

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
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securityLoadError, setSecurityLoadError] = useState<string | null>(null);
  const [securityActionError, setSecurityActionError] = useState<string | null>(null);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [mfaCodeInput, setMfaCodeInput] = useState("");
  const [securityPending, setSecurityPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cfg = await fetchSecurityConfig();
        if (!cancelled) {
          setSecurityConfig(cfg);
        }
      } catch (err) {
        if (!cancelled) {
          setSecurityLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setSecurityLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const actor = "admin@example.com";
  const role = "admin";

  async function handleMfaToggle(enable: boolean) {
    if (!securityConfig) return;
    setSecurityPending(true);
    setSecurityMessage(null);
    setSecurityActionError(null);
    try {
      const updated = await toggleMfa(enable, {
        config: securityConfig,
        actor,
        role,
        code: mfaCodeInput || undefined
      });
      setSecurityConfig(updated);
      setSecurityMessage(`MFA ${enable ? "enabled" : "disabled"} successfully.`);
      setMfaCodeInput("");
    } catch (err) {
      setSecurityActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSecurityPending(false);
    }
  }

  async function handleEncryptionToggle(enforce: boolean) {
    if (!securityConfig) return;
    setSecurityPending(true);
    setSecurityMessage(null);
    setSecurityActionError(null);
    try {
      const updated = await toggleEncryption(enforce, {
        config: securityConfig,
        actor,
        role,
        code: mfaCodeInput || undefined
      });
      setSecurityConfig(updated);
      setSecurityMessage(`Transport encryption ${enforce ? "enforced" : "disabled"}.`);
      setMfaCodeInput("");
    } catch (err) {
      setSecurityActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSecurityPending(false);
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
            {securityLoading && <p>Loading security configuration…</p>}
            {!securityLoading && securityLoadError && (
              <p style={{ color: "#b00020" }}>Unable to load security settings: {securityLoadError}</p>
            )}
            {!securityLoading && securityConfig && (
              <div className="space-y-4">
                <div>
                  <strong>MFA status:</strong> {securityConfig.mfaEnabled ? "Enabled" : "Disabled"}
                </div>
                <div>
                  <strong>Transport encryption:</strong> {securityConfig.encryptionEnforced ? "Required" : "Optional"}
                  <div style={{ fontSize: 12, color: "#555" }}>
                    TLS detected: {securityConfig.tlsActive ? "yes" : "no"}
                  </div>
                </div>
                {securityConfig.demoTotpSecret && (
                  <div style={{ fontSize: 12, color: "#555" }}>
                    Dev TOTP secret: {securityConfig.demoTotpSecret}
                  </div>
                )}
                <div>
                  <label htmlFor="security-mfa-code" style={{ display: "block", marginBottom: 8 }}>
                    Current MFA code
                  </label>
                  <input
                    id="security-mfa-code"
                    className="settings-input"
                    style={{ width: "100%" }}
                    placeholder="Enter 6-digit code"
                    value={mfaCodeInput}
                    onChange={e => setMfaCodeInput(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    className="button"
                    disabled={securityPending}
                    onClick={() => handleMfaToggle(!securityConfig.mfaEnabled)}
                  >
                    {securityConfig.mfaEnabled ? "Disable" : "Enable"} MFA for privileged actions
                  </button>
                  <button
                    className="button"
                    disabled={securityPending}
                    onClick={() => handleEncryptionToggle(!securityConfig.encryptionEnforced)}
                  >
                    {securityConfig.encryptionEnforced ? "Disable" : "Enforce"} transport encryption
                  </button>
                </div>
                {securityMessage && <div style={{ color: "#006400" }}>{securityMessage}</div>}
                {securityActionError && (
                  <div style={{ color: "#b00020" }}>{securityActionError}</div>
                )}
              </div>
            )}
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
      </div>
    </div>
  );
}
