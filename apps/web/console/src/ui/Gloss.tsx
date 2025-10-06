import { useEffect, useId, useState, type ReactNode } from "react";
import glossary from "../../../../../content/glossary.json";

type GlossaryEntry = {
  short: string;
  more: string;
};

type Glossary = Record<string, GlossaryEntry>;

const glossaryData: Glossary = glossary as Glossary;

export interface GlossProps {
  term: string;
  children: ReactNode;
}

export function Gloss({ term, children }: GlossProps) {
  const entry = glossaryData[term];
  const [open, setOpen] = useState(false);
  const tooltipId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!entry) {
    return <>{children}</>;
  }

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => setOpen(value => !value)}
        style={{
          background: "none",
          border: 0,
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
          cursor: "help",
          display: "inline",
        }}
      >
        <span
          style={{
            textDecorationLine: "underline",
            textDecorationStyle: "dotted",
            textDecorationColor: "currentColor",
          }}
        >
          {children}
        </span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          marginTop: 4,
          padding: "8px 12px",
          maxWidth: 260,
          borderRadius: 8,
          backgroundColor: "rgba(15, 23, 42, 0.96)",
          color: "#ffffff",
          fontSize: 12,
          lineHeight: 1.4,
          boxShadow: "0 6px 18px rgba(15, 23, 42, 0.2)",
          opacity: open ? 1 : 0,
          visibility: open ? "visible" : "hidden",
          transition: "opacity 120ms ease, visibility 120ms ease",
          pointerEvents: open ? "auto" : "none",
          zIndex: 20,
          textAlign: "left",
        }}
      >
        <span>{entry.short} </span>
        <a
          href={entry.more}
          style={{
            color: "#bfdbfe",
            marginLeft: 4,
            textDecoration: "underline",
          }}
        >
          Learn more
        </a>
      </span>
    </span>
  );
}
