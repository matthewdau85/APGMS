import React, { useState, useEffect, useCallback, useRef } from "react";

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

type ProofsIndex = {
  date: string;
  generatedAt: string | null;
  files: { name: string; size: number; sha256: string }[];
  checksum: { algorithm: string; value: string };
  signedChecksum: { algorithm: string; signature: string; keyId?: string };
  metadata?: {
    rulesVersion?: string | null;
    rulesOwner?: string | null;
    reviewCadenceDays?: number | null;
  };
  downloadUrl: string;
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState(tabs[0]);
  // Mock business profile state
  const [profile, setProfile] = useState({
    abn: "12 345 678 901",
    name: "Example Pty Ltd",
    trading: "Example Vending",
    contact: "info@example.com"
  });
  const [proofs, setProofs] = useState<ProofsIndex | null>(null);
  const [proofsLoading, setProofsLoading] = useState(false);
  const [proofsError, setProofsError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const requestedProofs = useRef(false);

  const authHeaders = useCallback(() => ({
    "X-APGMS-Admin": "true",
    "X-APGMS-MFA": "true"
  }), []);

  const fetchProofs = useCallback(async () => {
    setProofsLoading(true);
    setProofsError(null);
    try {
      const response = await fetch("/api/ops/compliance/proofs", {
        headers: authHeaders()
      });
      const text = await response.text();
      let payload: any = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch (err) {
          throw new Error("Unable to parse proofs response");
        }
      }
      if (!response.ok) {
        throw new Error(payload?.error ?? `Request failed (${response.status})`);
      }
      setProofs(payload as ProofsIndex);
    } catch (err) {
      setProofsError(err instanceof Error ? err.message : "Unable to load evidence pack");
    } finally {
      setProofsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (activeTab === "Compliance & Audit" && !requestedProofs.current) {
      requestedProofs.current = true;
      fetchProofs();
    }
  }, [activeTab, fetchProofs]);

  const handleDownload = useCallback(async () => {
    if (!proofs) return;
    setDownloading(true);
    setProofsError(null);
    try {
      const response = await fetch(proofs.downloadUrl, { headers: authHeaders() });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `evte-pack-${proofs.date}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setProofsError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }, [authHeaders, proofs]);

  const formatSize = useCallback((size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

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
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <div
              style={{
                background: "#fdfdfd",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 24,
                marginBottom: 24
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Weekly EVTE/DSP Evidence Pack</h3>
                <div>
                  <button className="button" style={{ marginRight: 12 }} onClick={fetchProofs} disabled={proofsLoading}>
                    {proofsLoading ? "Refreshing..." : "Refresh"}
                  </button>
                  <button className="button" onClick={handleDownload} disabled={!proofs || downloading}>
                    {downloading ? "Preparing..." : "Download ZIP"}
                  </button>
                </div>
              </div>
              {proofsLoading && (
                <p style={{ marginTop: 16 }}>Loading the latest compliance evidence…</p>
              )}
              {proofsError && (
                <div style={{ marginTop: 16, color: "#b91c1c" }}>
                  <strong>Unable to load pack:</strong> {proofsError}
                </div>
              )}
              {proofs && !proofsLoading && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ marginBottom: 8 }}>
                    <strong>Pack date:</strong> {proofs.date}
                  </p>
                  <p style={{ marginBottom: 8 }}>
                    <strong>Generated at:</strong>{" "}
                    {proofs.generatedAt ? new Date(proofs.generatedAt).toLocaleString() : "—"}
                  </p>
                  {proofs.metadata && (
                    <p style={{ marginBottom: 8 }}>
                      <strong>Rules version:</strong> {proofs.metadata.rulesVersion ?? "—"} &middot; <strong>Owner:</strong>{" "}
                      {proofs.metadata.rulesOwner ?? "—"}
                      {typeof proofs.metadata.reviewCadenceDays === "number" && (
                        <span>{" "}&middot; Review every {proofs.metadata.reviewCadenceDays} days</span>
                      )}
                    </p>
                  )}
                  <p style={{ marginBottom: 8 }}>
                    <strong>Checksum:</strong>{" "}
                    <code>{proofs.checksum.value}</code>
                  </p>
                  <p style={{ marginBottom: 16 }}>
                    <strong>Signed by:</strong>{" "}
                    {proofs.signedChecksum.keyId ?? "unknown key"}
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #e2e8f0" }}>File</th>
                          <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #e2e8f0" }}>Size</th>
                          <th style={{ textAlign: "left", padding: "8px", borderBottom: "1px solid #e2e8f0" }}>SHA-256</th>
                        </tr>
                      </thead>
                      <tbody>
                        {proofs.files.map(file => (
                          <tr key={file.name}>
                            <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9" }}>{file.name}</td>
                            <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9" }}>{formatSize(file.size)}</td>
                            <td style={{ padding: "8px", borderBottom: "1px solid #f1f5f9", fontFamily: "monospace" }}>
                              {file.sha256}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div style={{ background: "#f9f9f9", borderRadius: 12, padding: 24 }}>
              <h4 style={{ marginTop: 0 }}>Audit Log (Mock)</h4>
              <ul>
                <li>05/06/2025 - PAYGW transfer scheduled</li>
                <li>29/05/2025 - BAS submitted</li>
              </ul>
            </div>
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
