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
  const [authToken, setAuthToken] = useState<string>("");
  const [mfaCode, setMfaCode] = useState<string>("");
  const [mfaStatus, setMfaStatus] = useState<"unknown" | "enrolled" | "not-enrolled">("unknown");
  const [enrollResponse, setEnrollResponse] = useState<{ secretHex: string; otpauth: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("apgms_auth_token") || "";
      if (stored) {
        setAuthToken(stored);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (authToken) {
        window.localStorage.setItem("apgms_auth_token", authToken);
      } else {
        window.localStorage.removeItem("apgms_auth_token");
      }
    }
  }, [authToken]);

  useEffect(() => {
    if (activeTab === "Security" && authToken) {
      refreshStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, authToken]);

  async function callSecurity(path: string, init?: RequestInit & { skipMfaHeader?: boolean }) {
    if (!authToken) {
      throw new Error("Set an API token first");
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`,
    };
    if (!init?.skipMfaHeader && mfaCode) {
      headers["x-mfa-code"] = mfaCode;
    }
    const response = await fetch(`/api/security${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
    });
    const text = await response.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!response.ok) {
      throw new Error(json?.error || json || `HTTP ${response.status}`);
    }
    return json;
  }

  async function refreshStatus() {
    try {
      setIsBusy(true);
      setStatusMessage("");
      const res = await callSecurity("/mfa/status");
      setMfaStatus(res.enrolled ? "enrolled" : "not-enrolled");
      setStatusMessage(res.enrolled ? "MFA is enrolled." : "MFA not yet enrolled.");
    } catch (err: any) {
      setStatusMessage(err?.message || "Failed to load status");
      setMfaStatus("unknown");
    } finally {
      setIsBusy(false);
    }
  }

  async function enroll() {
    try {
      setIsBusy(true);
      setStatusMessage("Generating secret...");
      const res = await callSecurity("/mfa/enroll", { method: "POST", body: JSON.stringify({}) });
      setEnrollResponse(res);
      setMfaStatus("not-enrolled");
      setStatusMessage("Scan the QR code URL or enter the secret, then verify a code.");
    } catch (err: any) {
      setStatusMessage(err?.message || "Failed to enroll");
    } finally {
      setIsBusy(false);
    }
  }

  async function verify() {
    try {
      setIsBusy(true);
      setStatusMessage("Validating code...");
      const res = await callSecurity("/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
        skipMfaHeader: true,
      });
      if (res?.ok) {
        setStatusMessage("MFA verified. Codes will be required for sensitive actions.");
        setMfaStatus("enrolled");
        await refreshStatus();
      } else {
        setStatusMessage("Verification failed");
      }
    } catch (err: any) {
      setStatusMessage(err?.message || "Failed to verify");
    } finally {
      setIsBusy(false);
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
          <div style={{ maxWidth: 700, margin: "0 auto" }}>
            <h3>Authentication &amp; MFA</h3>
            <p style={{ fontSize: 14, color: "#555" }}>
              Provide an API token issued by the platform security team to manage your profile.
              Sensitive operations require a TOTP code that expires every 30 seconds.
            </p>
            <label style={{ display: "block", marginTop: 12 }}>API Token</label>
            <input
              className="settings-input"
              style={{ width: "100%" }}
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value.trim())}
              placeholder="Bearer token"
            />
            <label style={{ display: "block", marginTop: 12 }}>Current MFA Code</label>
            <input
              className="settings-input"
              style={{ width: 220 }}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
            />
            <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button className="button" disabled={isBusy || !authToken} onClick={refreshStatus}>
                Check Status
              </button>
              <button className="button" disabled={isBusy || !authToken} onClick={enroll}>
                Generate MFA Secret
              </button>
              <button className="button" disabled={isBusy || !authToken || !mfaCode} onClick={verify}>
                Verify Code
              </button>
            </div>
            {statusMessage && (
              <div style={{ marginTop: 14, fontSize: 14, color: mfaStatus === "enrolled" ? "#067647" : "#9f580a" }}>
                {statusMessage}
              </div>
            )}
            {enrollResponse && (
              <div style={{ marginTop: 16, background: "#f4f7ff", padding: 16, borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>Enrollment details</h4>
                <p style={{ wordBreak: "break-all", fontFamily: "monospace" }}>
                  Secret (hex): {enrollResponse.secretHex}
                </p>
                <p>
                  <a href={enrollResponse.otpauth} target="_blank" rel="noreferrer">
                    Open in authenticator
                  </a>
                </p>
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
