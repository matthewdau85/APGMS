import React, { useMemo, useState } from "react";

type Status = "pending" | "passed" | "failed" | "processing";

type PreflightCheck = {
  id: string;
  name: string;
  description: string;
  status: Status;
  resolution?: string;
};

type ReconIssue = {
  id: string;
  description: string;
  action: string;
  resolved: boolean;
};

const stepOrder = [
  "Preflight checks",
  "Close period",
  "Reconcile",
  "Issue RPT",
  "Release",
  "Summary & evidence",
];

const initialPreflight: PreflightCheck[] = [
  {
    id: "exports",
    name: "Payroll exports complete",
    description: "Latest STP event received and mapped for the reporting period.",
    status: "pending",
    resolution: "Confirm payroll provider has pushed the final pay run.",
  },
  {
    id: "bank-feed",
    name: "Bank feed connected",
    description: "Operating and PAYGW buffer accounts are connected and up to date.",
    status: "pending",
    resolution: "Reconnect bank feed or ingest latest statement file.",
  },
  {
    id: "adjustments",
    name: "Outstanding adjustments",
    description: "2 manual journals flagged for review.",
    status: "pending",
    resolution: "Acknowledge or reverse outstanding adjustments before closing.",
  },
];

const initialReconIssues: ReconIssue[] = [
  {
    id: "stp-net",
    description: "STP net wages do not match GL payroll expense (variance $124.12).",
    action: "Apply variance to suspense and rerun reconciliation.",
    resolved: false,
  },
  {
    id: "gst-sales",
    description: "Square POS GST on sales missing for 3 takings (02–04 Oct).",
    action: "Re-pull takings for the affected days.",
    resolved: false,
  },
];

export default function CloseToReleaseWizard() {
  const [activeStep, setActiveStep] = useState(0);
  const [checks, setChecks] = useState(initialPreflight);
  const [checksRan, setChecksRan] = useState(false);
  const [periodClosed, setPeriodClosed] = useState(false);
  const [reconStatus, setReconStatus] = useState<Status>("pending");
  const [reconIssues, setReconIssues] = useState(initialReconIssues);
  const [rptIssued, setRptIssued] = useState(false);
  const [rptType, setRptType] = useState<"FINAL" | "REPLACEMENT">("FINAL");
  const [releaseMode, setReleaseMode] = useState<"DRY_RUN" | "REAL">("DRY_RUN");
  const [releaseConfirmed, setReleaseConfirmed] = useState(false);

  const periodSummary = useMemo(
    () => ({
      entity: "Example Pty Ltd",
      abn: "12 345 678 901",
      period: "September 2025",
      takings: 84233.4,
      paygw: 12450.88,
      gst: 8700.22,
    }),
    []
  );

  const allChecksPassed = checks.every((check) => check.status === "passed");
  const unresolvedIssues = reconIssues.filter((issue) => !issue.resolved);
  const reconPassed = reconStatus === "passed" && unresolvedIssues.length === 0;

  const nextDisabled = useMemo(() => {
    switch (activeStep) {
      case 0:
        return !allChecksPassed;
      case 1:
        return !periodClosed;
      case 2:
        return !reconPassed;
      case 3:
        return !rptIssued;
      case 4:
        return !(releaseConfirmed && releaseMode);
      default:
        return false;
    }
  }, [activeStep, allChecksPassed, periodClosed, reconPassed, rptIssued, releaseConfirmed, releaseMode]);

  const runPreflight = () => {
    const result = checks.map((check) => {
      if (check.id === "adjustments") {
        return { ...check, status: "failed" };
      }
      return { ...check, status: "passed" };
    });
    setChecks(result);
    setChecksRan(true);
  };

  const resolveCheck = (id: string) => {
    setChecks((prev) =>
      prev.map((check) =>
        check.id === id ? { ...check, status: "passed", description: "No outstanding adjustments remaining." } : check
      )
    );
  };

  const closePeriod = () => {
    setPeriodClosed(true);
  };

  const runReconciliation = () => {
    setReconStatus("processing");
    // Simulate a reconciliation run that surfaces current unresolved issues
    setTimeout(() => {
      if (unresolvedIssues.length > 0) {
        setReconStatus("failed");
      } else {
        setReconStatus("passed");
      }
    }, 250);
  };

  const resolveIssue = (id: string) => {
    setReconIssues((prev) => prev.map((issue) => (issue.id === id ? { ...issue, resolved: true } : issue)));
    setReconStatus("pending");
  };

  const issueRpt = () => {
    setRptIssued(true);
  };

  const confirmRelease = () => {
    setReleaseConfirmed((prev) => !prev);
  };

  const goNext = () => {
    if (activeStep < stepOrder.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const goBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const handleDownloadEvidence = () => {
    const payload = {
      flow: "Close→RPT→Release",
      generatedAt: new Date().toISOString(),
      period: periodSummary.period,
      abn: periodSummary.abn,
      releaseMode,
      rptType,
      reconciliationIssuesResolved: reconIssues.every((issue) => issue.resolved),
      paygw: periodSummary.paygw,
      gst: periodSummary.gst,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `rpt_evidence_${periodSummary.period.replace(/\s+/g, "-").toLowerCase()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <div>
            <p className="wizard-subtitle">
              Run automated checks before locking the period. All items must pass to continue.
            </p>
            <button className="button" onClick={runPreflight}>
              Run preflight checks
            </button>
            <div className="status-list">
              {checks.map((check) => (
                <div key={check.id} className="status-row">
                  <div>
                    <p className="status-title">{check.name}</p>
                    <p className="status-description">{check.description}</p>
                    {check.status === "failed" && (
                      <p className="status-resolution">
                        {check.resolution}
                        <br />
                        <button className="link-button" onClick={() => resolveCheck(check.id)}>
                          Mark resolved
                        </button>
                      </p>
                    )}
                  </div>
                  <span className={`status-pill status-${check.status}`}>
                    {check.status === "pending" && (checksRan ? "Waiting" : "Not run")}
                    {check.status === "passed" && "Passed"}
                    {check.status === "failed" && "Action needed"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      case 1:
        return (
          <div>
            <p className="wizard-subtitle">
              Lock transactions for the period so no late adjustments slip through.
            </p>
            <div className="summary-grid">
              <div>
                <p className="summary-label">Entity</p>
                <p className="summary-value">{periodSummary.entity}</p>
              </div>
              <div>
                <p className="summary-label">ABN</p>
                <p className="summary-value">{periodSummary.abn}</p>
              </div>
              <div>
                <p className="summary-label">Period</p>
                <p className="summary-value">{periodSummary.period}</p>
              </div>
            </div>
            <div className="summary-grid">
              <div>
                <p className="summary-label">Total takings</p>
                <p className="summary-value">${periodSummary.takings.toLocaleString()}</p>
              </div>
              <div>
                <p className="summary-label">PAYGW withheld</p>
                <p className="summary-value">${periodSummary.paygw.toLocaleString()}</p>
              </div>
              <div>
                <p className="summary-label">GST owing</p>
                <p className="summary-value">${periodSummary.gst.toLocaleString()}</p>
              </div>
            </div>
            <button className={`button ${periodClosed ? "button-secondary" : ""}`} onClick={closePeriod}>
              {periodClosed ? "Period locked" : "Close period"}
            </button>
            {periodClosed && <p className="success-note">Period closed successfully. You can reopen from Settings if required.</p>}
          </div>
        );
      case 2:
        return (
          <div>
            <p className="wizard-subtitle">
              Reconcile ledger, payroll and POS feeds. You must clear variances before issuing an RPT.
            </p>
            <button className="button" onClick={runReconciliation}>
              {reconStatus === "processing" ? "Running checks..." : "Run reconciliation"}
            </button>
            <div className="status-list">
              {reconIssues.map((issue) => (
                <div key={issue.id} className="status-row">
                  <div>
                    <p className="status-title">{issue.description}</p>
                    <p className="status-resolution">{issue.action}</p>
                    {!issue.resolved && (
                      <button className="link-button" onClick={() => resolveIssue(issue.id)}>
                        Resolve and re-run
                      </button>
                    )}
                    {issue.resolved && <p className="success-note">Resolved and documented.</p>}
                  </div>
                  <span className={`status-pill status-${issue.resolved ? "passed" : "failed"}`}>
                    {issue.resolved ? "Cleared" : "Blocking"}
                  </span>
                </div>
              ))}
            </div>
            {reconStatus === "failed" && unresolvedIssues.length > 0 && (
              <div className="error-banner">
                Reconciliation failed. Resolve the blocking issues above before continuing.
              </div>
            )}
            {reconPassed && <p className="success-note">All sources reconcile. RPT is ready to issue.</p>}
          </div>
        );
      case 3:
        return (
          <div>
            <p className="wizard-subtitle">
              Prepare the Reporting Packet (RPT) for ATO and finance stakeholders.
            </p>
            <div className="form-field">
              <label>RPT type</label>
              <select
                className="settings-input"
                value={rptType}
                onChange={(event) => {
                  setRptType(event.target.value as "FINAL" | "REPLACEMENT");
                  setRptIssued(false);
                }}
              >
                <option value="FINAL">Final (standard)</option>
                <option value="REPLACEMENT">Replacement (supersedes previous)</option>
              </select>
            </div>
            <div className="form-field">
              <label>Recipients</label>
              <div className="chips-row">
                <span className="chip">ATO</span>
                <span className="chip">Finance Manager</span>
                <span className="chip">Auditor</span>
              </div>
            </div>
            <button className={`button ${rptIssued ? "button-secondary" : ""}`} onClick={issueRpt}>
              {rptIssued ? "RPT generated" : "Issue RPT"}
            </button>
            {rptIssued && (
              <p className="success-note">
                RPT issued. Distribution and digital signatures recorded in audit log.
              </p>
            )}
          </div>
        );
      case 4:
        return (
          <div>
            <p className="wizard-subtitle">
              Choose whether to run a dry run or final release. Dry run posts validation events only.
            </p>
            <div className="radio-group">
              <label className="radio-option">
                <input
                  type="radio"
                  name="release-mode"
                  value="DRY_RUN"
                  checked={releaseMode === "DRY_RUN"}
                  onChange={() => {
                    setReleaseMode("DRY_RUN");
                    setReleaseConfirmed(false);
                  }}
                />
                Dry run — push preview to ATO sandbox and internal reviewers.
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  name="release-mode"
                  value="REAL"
                  checked={releaseMode === "REAL"}
                  onChange={() => {
                    setReleaseMode("REAL");
                    setReleaseConfirmed(false);
                  }}
                />
                Real release — lodge to ATO production and trigger payments.
              </label>
            </div>
            <label className="checkbox-option">
              <input type="checkbox" checked={releaseConfirmed} onChange={confirmRelease} />
              I confirm all approvals captured and trust account balances cover PAYGW & GST obligations.
            </label>
            {releaseConfirmed && (
              <p className="success-note">
                Release queued. Monitor status from the BAS page or download evidence below.
              </p>
            )}
          </div>
        );
      case 5:
        return (
          <div>
            <p className="wizard-subtitle">
              Period successfully processed. Save the evidence packet to satisfy audit requirements.
            </p>
            <div className="summary-grid">
              <div>
                <p className="summary-label">Period</p>
                <p className="summary-value">{periodSummary.period}</p>
              </div>
              <div>
                <p className="summary-label">Release mode</p>
                <p className="summary-value">{releaseMode === "DRY_RUN" ? "Dry run" : "Real release"}</p>
              </div>
              <div>
                <p className="summary-label">RPT type</p>
                <p className="summary-value">{rptType === "FINAL" ? "Final" : "Replacement"}</p>
              </div>
            </div>
            <div className="summary-grid">
              <div>
                <p className="summary-label">PAYGW</p>
                <p className="summary-value">${periodSummary.paygw.toLocaleString()}</p>
              </div>
              <div>
                <p className="summary-label">GST</p>
                <p className="summary-value">${periodSummary.gst.toLocaleString()}</p>
              </div>
              <div>
                <p className="summary-label">Reconciliation status</p>
                <p className="summary-value">All variances cleared</p>
              </div>
            </div>
            <button className="button" onClick={handleDownloadEvidence}>
              Download evidence JSON
            </button>
            <p className="success-note">Evidence file includes digital signatures and hash of lodged payloads.</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="wizard-panel">
      <ol className="wizard-stepper">
        {stepOrder.map((label, index) => (
          <li key={label} className={index === activeStep ? "active" : index < activeStep ? "done" : ""}>
            <span className="step-index">{index + 1}</span>
            <span className="step-label">{label}</span>
          </li>
        ))}
      </ol>
      <div className="wizard-content">{renderStepContent()}</div>
      <div className="wizard-actions">
        <button className="button button-secondary" onClick={goBack} disabled={activeStep === 0}>
          Back
        </button>
        <button className="button" onClick={goNext} disabled={nextDisabled || activeStep === stepOrder.length - 1}>
          {activeStep === stepOrder.length - 2 ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}
