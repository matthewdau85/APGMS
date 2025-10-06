import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import CloseToReleaseWizard from "../components/wizards/CloseToReleaseWizard";
import ConnectorSetupWizard from "../components/wizards/ConnectorSetupWizard";

type Flow = {
  id: "close-release" | "connector-setup";
  title: string;
  subtitle: string;
  component: React.ReactNode;
  outcomes: string[];
};

const flows: Flow[] = [
  {
    id: "close-release",
    title: "Close → RPT → Release",
    subtitle: "Lock the period, reconcile and lodge with evidence in minutes.",
    component: <CloseToReleaseWizard />,
    outcomes: [
      "Automated preflight checks",
      "Reconciliation blockers called out",
      "Evidence download for audits",
    ],
  },
  {
    id: "connector-setup",
    title: "Ingestion connectors",
    subtitle: "Provision STP/POS secrets and prove events with test payloads.",
    component: <ConnectorSetupWizard />,
    outcomes: [
      "Generate API credentials",
      "Webhook URLs + HMAC shared",
      "Green checks for test events",
    ],
  },
];

export default function Wizard() {
  const location = useLocation();
  const defaultFlow = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get("flow");
    return (flows.find((flow) => flow.id === requested)?.id ?? flows[0].id) as Flow["id"];
  }, [location.search]);

  const [activeFlow, setActiveFlow] = useState<Flow["id"]>(defaultFlow);

  useEffect(() => {
    setActiveFlow(defaultFlow);
  }, [defaultFlow]);

  const selectedFlow = flows.find((flow) => flow.id === activeFlow) ?? flows[0];

  return (
    <div className="main-card">
      <header className="wizard-header">
        <div>
          <h1>Guided workflows & wizards</h1>
          <p>
            Run the happy-path flows without reading the playbook. We enforce prerequisites, block unsafe actions and
            leave you with audit-ready evidence.
          </p>
        </div>
        <div className="wizard-callouts">
          <div>
            <p className="callout-number">1</p>
            <span>Close → RPT → Release</span>
          </div>
          <div>
            <p className="callout-number">2</p>
            <span>STP & POS ingestion</span>
          </div>
        </div>
      </header>

      <div className="wizard-layout">
        <aside className="wizard-nav">
          <h2>Pick a flow</h2>
          <ul>
            {flows.map((flow) => (
              <li key={flow.id}>
                <button
                  className={`wizard-nav-button ${flow.id === selectedFlow.id ? "active" : ""}`}
                  onClick={() => setActiveFlow(flow.id)}
                >
                  <span className="wizard-nav-title">{flow.title}</span>
                  <span className="wizard-nav-subtitle">{flow.subtitle}</span>
                  <ul className="wizard-nav-outcomes">
                    {flow.outcomes.map((outcome) => (
                      <li key={outcome}>• {outcome}</li>
                    ))}
                  </ul>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="wizard-stage">{selectedFlow.component}</section>
      </div>
    </div>
  );
}
