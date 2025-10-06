import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Joyride, { CallBackProps, Step } from "react-joyride";

type WorkspaceState = {
  payrollConnected: boolean;
  basDrafted: boolean;
  evidenceUploaded: boolean;
  adminInvited: boolean;
};

const containerStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
  backgroundColor: "#f5f6fa",
  minHeight: "100vh",
};

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
  marginBottom: 24,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  background: "#2563eb",
  color: "#fff",
  border: "none",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#111827",
};

function EmptyState(props: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  actionId: string;
  helpUrl: string;
  done: boolean;
  successMessage: string;
}) {
  const { title, description, actionLabel, onAction, actionId, helpUrl, done, successMessage } = props;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>{title}</h3>
        <p style={{ margin: 0, color: "#4b5563", fontSize: 14 }}>{description}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button
          id={actionId}
          style={done ? secondaryButtonStyle : buttonStyle}
          onClick={onAction}
        >
          {done ? `Review ${title.toLowerCase()}` : actionLabel}
        </button>
        <a
          href={helpUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: "#2563eb", fontWeight: 600, fontSize: 14 }}
        >
          View help guide ↗
        </a>
      </div>
      <p style={{ margin: 0, color: done ? "#047857" : "#6b7280", fontSize: 14 }}>
        {done ? successMessage : "No data yet"}
      </p>
    </div>
  );
}

function Section(props: React.PropsWithChildren<{ id: string; title: string; subtitle: string }>) {
  const { id, title, subtitle, children } = props;
  return (
    <section id={id} style={sectionStyle}>
      <header style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
        <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 15 }}>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    payrollConnected: false,
    basDrafted: false,
    evidenceUploaded: false,
    adminInvited: false,
  });

  const [tourRun, setTourRun] = useState(true);

  const steps = useMemo<Step[]>(
    () => [
      {
        target: "#tour-welcome",
        content:
          "Welcome to APGMS! This guided tour shows the key areas to complete your first compliance run.",
        disableBeacon: true,
        placement: "center",
      },
      {
        target: "#tour-dashboard",
        content: "The dashboard highlights your onboarding tasks. Start by connecting payroll to unlock W1/W2 tiles.",
      },
      {
        target: "#tour-connect-payroll",
        content: "Use this call-to-action to connect Single Touch Payroll (STP). We will surface W1/W2 data once connected.",
      },
      {
        target: "#tour-bas",
        content: "Business Activity Statements (BAS) live here. Draft your first BAS once payroll is connected.",
      },
      {
        target: "#tour-start-bas",
        content: "Create a BAS draft. We pull your liabilities into the BAS workspace automatically.",
      },
      {
        target: "#tour-evidence",
        content: "Upload payroll evidence so reviewers can reconcile STP data against lodged figures.",
      },
      {
        target: "#tour-admin",
        content: "Invite colleagues and configure automations from Admin Ops to keep compliance humming.",
      },
    ],
    []
  );

  const handleTourCallback = (data: CallBackProps) => {
    if (data.status === "finished" || data.status === "skipped") {
      setTourRun(false);
    }
  };

  const completeTask = (key: keyof WorkspaceState) => {
    setWorkspace((prev) => ({ ...prev, [key]: true }));
  };

  return (
    <div style={containerStyle}>
      <Joyride
        steps={steps}
        run={tourRun}
        continuous
        showProgress
        showSkipButton
        styles={{ options: { primaryColor: "#2563eb" } }}
        callback={handleTourCallback}
      />
      <div id="tour-welcome" style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>APGMS Console</h1>
        <p style={{ margin: "8px 0 0", color: "#4b5563", maxWidth: 560 }}>
          Follow the guided steps below to connect payroll, draft your first BAS, upload supporting evidence,
          and invite your compliance team.
        </p>
      </div>

      <Section
        id="tour-dashboard"
        title="Dashboard overview"
        subtitle="Your launchpad for STP, BAS, and evidence tasks"
      >
        <EmptyState
          title="Payroll data"
          description="Connect payroll (STP) to see W1/W2."
          actionLabel="Connect payroll (STP)"
          actionId="tour-connect-payroll"
          helpUrl="https://help.apgms.example/onboarding/payroll"
          onAction={() => completeTask("payrollConnected")}
          done={workspace.payrollConnected}
          successMessage="Payroll connected • W1/W2 tiles will refresh every 30 minutes."
        />
      </Section>

      <Section
        id="tour-bas"
        title="Business Activity Statements"
        subtitle="Create and lodge BAS with pre-filled liabilities"
      >
        <EmptyState
          title="First BAS"
          description="Start your first BAS draft to review GST, PAYG, and withholding obligations."
          actionLabel="Start BAS draft"
          actionId="tour-start-bas"
          helpUrl="https://help.apgms.example/bas/first-draft"
          onAction={() => completeTask("basDrafted")}
          done={workspace.basDrafted}
          successMessage="Draft in progress • GST, PAYG-W, and PAYG-I prefilled from payroll sync."
        />
      </Section>

      <Section
        id="tour-evidence"
        title="Evidence workspace"
        subtitle="Keep payroll evidence aligned with each BAS period"
      >
        <EmptyState
          title="Upload payroll evidence"
          description="Attach the payroll register or STP finalisation file for the period."
          actionLabel="Upload evidence"
          actionId="tour-upload-evidence"
          helpUrl="https://help.apgms.example/evidence"
          onAction={() => completeTask("evidenceUploaded")}
          done={workspace.evidenceUploaded}
          successMessage="Evidence received • Reviewers will be notified to reconcile figures."
        />
      </Section>

      <Section
        id="tour-admin"
        title="Admin Ops"
        subtitle="Control user access and automation preferences"
      >
        <EmptyState
          title="Team access"
          description="Invite colleagues to review BAS drafts, lodge, and manage payments."
          actionLabel="Invite a teammate"
          actionId="tour-invite-admin"
          helpUrl="https://help.apgms.example/admin-ops"
          onAction={() => completeTask("adminInvited")}
          done={workspace.adminInvited}
          successMessage="Invite sent • They will receive setup instructions and MFA requirements."
        />
      </Section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
