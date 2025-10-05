import React from "react";

interface SecuritySettingsProps {
  options: { mfa: boolean; auditLog: boolean; encryption: boolean };
  onUpdate: (opts: { mfa: boolean; auditLog: boolean; encryption: boolean }) => void;
}

export default function SecuritySettings({ options, onUpdate }: SecuritySettingsProps) {
  function handleToggle(field: keyof typeof options) {
    onUpdate({ ...options, [field]: !options[field] });
  }

  return (
    <div className="card">
      <h3>Security Settings</h3>
      <p>
        <b>Configure system security:</b> <br />
        <span style={{ color: "#444", fontSize: "0.97em" }}>
          Enable or disable the following security features for your APGMS instance.
        </span>
      </p>
      <label style={{ display: "block", margin: "0.6em 0" }}>
        <input
          type="checkbox"
          checked={options.mfa}
          onChange={() => handleToggle("mfa")}
        />{" "}
        Multi-Factor Authentication (MFA)
      </label>
      <label style={{ display: "block", margin: "0.6em 0" }}>
        <input
          type="checkbox"
          checked={options.auditLog}
          onChange={() => handleToggle("auditLog")}
        />{" "}
        Audit Logging
      </label>
      <label style={{ display: "block", margin: "0.6em 0" }}>
        <input
          type="checkbox"
          checked={options.encryption}
          onChange={() => handleToggle("encryption")}
        />{" "}
        End-to-End Encryption
      </label>
    </div>
  );
}
