import React from "react";

type HelpLink = {
  label: string;
  href: string;
};

type ContextPanelProps = {
  title: string;
  description: string;
  steps: string[];
  links: HelpLink[];
  onClose?: () => void;
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(0, 0, 0, 0.35)",
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "flex-start",
  padding: 24,
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(15, 23, 42, 0.25)",
  width: "min(420px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  padding: "24px 28px",
  position: "relative",
};

const closeButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  background: "none",
  border: "none",
  fontSize: 20,
  cursor: "pointer",
  color: "#334155",
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  marginBottom: 12,
  color: "#0f172a",
};

const descriptionStyle: React.CSSProperties = {
  marginBottom: 20,
  lineHeight: 1.5,
  color: "#1e293b",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1,
  marginBottom: 8,
  color: "#475569",
};

const listStyle: React.CSSProperties = {
  margin: "0 0 16px 18px",
  padding: 0,
  color: "#0f172a",
  lineHeight: 1.5,
};

const linkListStyle: React.CSSProperties = {
  margin: "0 0 0 18px",
  padding: 0,
  color: "#2563eb",
  lineHeight: 1.6,
};

const ContextPanel: React.FC<ContextPanelProps> = ({
  title,
  description,
  steps,
  links,
  onClose,
}) => {
  return (
    <div style={overlayStyle} role="presentation" onClick={onClose}>
      <div
        style={panelStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-panel-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close help panel"
          onClick={onClose}
          style={closeButtonStyle}
        >
          ×
        </button>
        <h2 id="context-panel-title" style={titleStyle}>
          {title}
        </h2>
        <p style={descriptionStyle}>{description}</p>
        <div>
          <div style={sectionTitleStyle}>Do this now</div>
          <ol style={listStyle}>
            {steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
        {links.length > 0 && (
          <div>
            <div style={sectionTitleStyle}>Need more detail?</div>
            <ul style={linkListStyle}>
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    style={{ color: "#2563eb", textDecoration: "none" }}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContextPanel;
