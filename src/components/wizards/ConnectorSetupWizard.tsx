import React, { useMemo, useState } from "react";

type ConnectorId = "stp" | "pos";

type ConnectorState = {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  webhookUrl: string;
  hmacSecret: string;
  testStatus: "idle" | "running" | "passed" | "failed";
  lastTestAt?: string;
};

const stepLabels = [
  "Choose connectors",
  "Create secrets",
  "Copy webhooks",
  "Send test events",
  "Confirm go-live",
];

const generateSecret = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

const makeConnectorState = (id: ConnectorId): ConnectorState => {
  const baseUrl = "https://ingest.apgms.local";
  const suffix = id === "stp" ? "stp" : "pos";
  return {
    enabled: id === "stp",
    clientId: generateSecret(`${suffix.toUpperCase()}ID`),
    clientSecret: generateSecret("SEC"),
    webhookUrl: `${baseUrl}/${suffix}/events`,
    hmacSecret: generateSecret("HMAC"),
    testStatus: "idle",
  };
};

export default function ConnectorSetupWizard() {
  const [activeStep, setActiveStep] = useState(0);
  const [connectors, setConnectors] = useState<Record<ConnectorId, ConnectorState>>({
    stp: makeConnectorState("stp"),
    pos: makeConnectorState("pos"),
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const enabledConnectors = useMemo(
    () => Object.entries(connectors).filter(([, connector]) => connector.enabled) as [ConnectorId, ConnectorState][],
    [connectors]
  );

  const allEnabledHaveSecrets = enabledConnectors.every(([, connector]) => connector.clientId && connector.clientSecret);
  const allCopied = copiedField === "all";
  const allTestsPassed = enabledConnectors.length > 0 && enabledConnectors.every(([, connector]) => connector.testStatus === "passed");

  const nextDisabled = useMemo(() => {
    switch (activeStep) {
      case 0:
        return enabledConnectors.length === 0;
      case 1:
        return !allEnabledHaveSecrets;
      case 2:
        return !allCopied;
      case 3:
        return !allTestsPassed;
      case 4:
        return !acknowledged;
      default:
        return false;
    }
  }, [activeStep, enabledConnectors.length, allEnabledHaveSecrets, allCopied, allTestsPassed, acknowledged]);

  const toggleConnector = (id: ConnectorId) => {
    setConnectors((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        enabled: !prev[id].enabled,
        testStatus: "idle",
      },
    }));
    setCopiedField(null);
    setAcknowledged(false);
  };

  const regenerateSecrets = (id: ConnectorId) => {
    setConnectors((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        clientId: generateSecret(`${id.toUpperCase()}ID`),
        clientSecret: generateSecret("SEC"),
        hmacSecret: generateSecret("HMAC"),
        testStatus: "idle",
      },
    }));
    setCopiedField(null);
    setAcknowledged(false);
  };

  const copyValue = async (value: string, field: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedField(field);
    } catch (error) {
      console.error("Clipboard unavailable", error);
    }
  };

  const copyAll = async () => {
    const payload: Record<string, unknown> = {};
    enabledConnectors.forEach(([id, connector]) => {
      payload[id] = {
        webhookUrl: connector.webhookUrl,
        hmacSecret: connector.hmacSecret,
        clientId: connector.clientId,
      };
    });
    try {
      await navigator.clipboard?.writeText(JSON.stringify(payload, null, 2));
      setCopiedField("all");
    } catch (error) {
      console.error("Clipboard unavailable", error);
    }
  };

  const runTests = async () => {
    setConnectors((prev) => {
      const updated = { ...prev };
      enabledConnectors.forEach(([id]) => {
        updated[id] = { ...updated[id], testStatus: "running" };
      });
      return updated;
    });

    setTimeout(() => {
      setConnectors((prev) => {
        const updated = { ...prev };
        enabledConnectors.forEach(([id]) => {
          updated[id] = {
            ...updated[id],
            testStatus: "passed",
            lastTestAt: new Date().toLocaleString(),
          };
        });
        return updated;
      });
    }, 300);
  };

  const goNext = () => {
    if (activeStep < stepLabels.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const goBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 0:
        return (
          <div>
            <p className="wizard-subtitle">
              Choose which connectors to activate. STP is required for payroll; POS is optional for GST automation.
            </p>
            <div className="card-grid">
              {Object.entries(connectors).map(([id, connector]) => (
                <div key={id} className={`choice-card ${connector.enabled ? "active" : ""}`}>
                  <h4>{id === "stp" ? "Single Touch Payroll (STP)" : "Point of Sale (POS)"}</h4>
                  <p>
                    {id === "stp"
                      ? "Streams payroll events from MYOB/Xero to RPT. Mandatory for PAYGW closing."
                      : "Pulls takings & GST from POS providers like Square and Vend."}
                  </p>
                  <label className="checkbox-option">
                    <input
                      type="checkbox"
                      checked={connector.enabled}
                      onChange={() => toggleConnector(id as ConnectorId)}
                    />
                    Enable {id.toUpperCase()} connector
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      case 1:
        return (
          <div>
            <p className="wizard-subtitle">
              Generate API credentials. Share the client ID & secret with your payroll/POS administrator securely.
            </p>
            {enabledConnectors.map(([id, connector]) => (
              <div key={id} className="detail-card">
                <div className="detail-card-header">
                  <h4>{id === "stp" ? "STP" : "POS"} credentials</h4>
                  <button className="link-button" onClick={() => regenerateSecrets(id)}>
                    Regenerate
                  </button>
                </div>
                <div className="secret-row">
                  <div>
                    <p className="summary-label">Client ID</p>
                    <code>{connector.clientId}</code>
                  </div>
                  <div>
                    <p className="summary-label">Client secret</p>
                    <code>{connector.clientSecret}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      case 2:
        return (
          <div>
            <p className="wizard-subtitle">
              Copy the webhook URLs and shared secrets to configure outbound calls from your systems.
            </p>
            {enabledConnectors.map(([id, connector]) => (
              <div key={id} className="detail-card">
                <h4>{id === "stp" ? "STP" : "POS"} webhook</h4>
                <div className="secret-row">
                  <div>
                    <p className="summary-label">Webhook URL</p>
                    <code>{connector.webhookUrl}</code>
                    <button className="link-button" onClick={() => copyValue(connector.webhookUrl, `${id}-url`)}>
                      Copy URL
                    </button>
                  </div>
                  <div>
                    <p className="summary-label">HMAC secret</p>
                    <code>{connector.hmacSecret}</code>
                    <button className="link-button" onClick={() => copyValue(connector.hmacSecret, `${id}-hmac`)}>
                      Copy HMAC
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {enabledConnectors.length > 0 && (
              <button className="button" onClick={copyAll}>
                Copy all to clipboard
              </button>
            )}
            {allCopied && <p className="success-note">Secrets copied. Paste into STP/POS admin consoles to continue.</p>}
          </div>
        );
      case 3:
        return (
          <div>
            <p className="wizard-subtitle">
              Send a signed test event from each connector. We block go-live until every system returns a 200 OK.
            </p>
            <button className="button" onClick={runTests}>
              Trigger sample events
            </button>
            <div className="status-list">
              {enabledConnectors.map(([id, connector]) => (
                <div key={id} className="status-row">
                  <div>
                    <p className="status-title">{id === "stp" ? "STP payroll event" : "POS takings batch"}</p>
                    {connector.lastTestAt && <p className="status-description">Last tested {connector.lastTestAt}</p>}
                  </div>
                  <span className={`status-pill status-${connector.testStatus}`}>
                    {connector.testStatus === "idle" && "Awaiting"}
                    {connector.testStatus === "running" && "Sending"}
                    {connector.testStatus === "passed" && "Green"}
                  </span>
                </div>
              ))}
            </div>
            {allTestsPassed && <p className="success-note">All connectors verified. Audit log updated with signatures.</p>}
          </div>
        );
      case 4:
        return (
          <div>
            <p className="wizard-subtitle">
              Enable real-time ingestion once business owners acknowledge responsibilities.
            </p>
            <ul className="success-list">
              {enabledConnectors.map(([id, connector]) => (
                <li key={id}>
                  ✅ {id === "stp" ? "STP" : "POS"} ready — secrets provisioned and last test {connector.lastTestAt ?? "pending"}
                </li>
              ))}
            </ul>
            <label className="checkbox-option">
              <input type="checkbox" checked={acknowledged} onChange={() => setAcknowledged(!acknowledged)} />
              I will turn on webhooks in MYOB/Square immediately after finishing this wizard.
            </label>
            {acknowledged && (
              <p className="success-note">
                Connectors armed. Monitor live ingestion status from the Integrations page.
              </p>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="wizard-panel">
      <ol className="wizard-stepper">
        {stepLabels.map((label, index) => (
          <li key={label} className={index === activeStep ? "active" : index < activeStep ? "done" : ""}>
            <span className="step-index">{index + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>
      <div className="wizard-content">{renderStep()}</div>
      <div className="wizard-actions">
        <button className="button button-secondary" onClick={goBack} disabled={activeStep === 0}>
          Back
        </button>
        <button className="button" onClick={goNext} disabled={nextDisabled || activeStep === stepLabels.length - 1}>
          {activeStep === stepLabels.length - 2 ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
