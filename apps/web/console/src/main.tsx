import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

type HelpDoc = {
  slug: string;
  title: string;
  summary: string;
  headings: string[];
  body: string;
  plainText: string;
};

type HelpIndexPayload = {
  generatedAt?: string;
  docs?: HelpDoc[];
};

type HelpTipProps = {
  term: string;
  slug: string;
  onOpen: (slug: string) => void;
};

type HelpCenterProps = {
  open: boolean;
  query: string;
  docs: HelpDoc[];
  filtered: HelpDoc[];
  activeSlug: string | null;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onSelectDoc: (slug: string) => void;
};

const appStyles: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  padding: 24,
  color: "#0f172a",
  backgroundColor: "#f8fafc",
  minHeight: "100vh"
};

const cardStyles: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
  border: "1px solid #e2e8f0"
};

const helpTipStyles: React.CSSProperties = {
  border: "none",
  background: "none",
  color: "#2563eb",
  textDecoration: "underline dotted",
  cursor: "pointer",
  padding: 0,
  margin: 0,
  font: "inherit",
  display: "inline-flex",
  alignItems: "center",
  gap: 6
};

const overlayStyles: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16
};

const dialogStyles: React.CSSProperties = {
  backgroundColor: "#ffffff",
  width: "min(960px, 100%)",
  maxHeight: "90vh",
  borderRadius: 16,
  boxShadow: "0 30px 60px rgba(15, 23, 42, 0.25)",
  display: "flex",
  flexDirection: "column"
};

const searchRowStyles: React.CSSProperties = {
  padding: "20px 24px 12px",
  borderBottom: "1px solid #e2e8f0"
};

const helpBodyStyles: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "280px 1fr",
  gap: 0,
  overflow: "hidden",
  flex: 1,
  minHeight: 0
};

const listStyles: React.CSSProperties = {
  borderRight: "1px solid #e2e8f0",
  overflowY: "auto"
};

const docStyles: React.CSSProperties = {
  padding: "20px 24px",
  overflowY: "auto",
  backgroundColor: "#f8fafc"
};

function HelpTip({ term, slug, onOpen }: HelpTipProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(slug)}
      style={helpTipStyles}
      aria-label={`Open help for ${term}`}
    >
      <span>{term}</span>
      <span style={{ fontSize: "0.75em", color: "#1d4ed8", fontWeight: 600 }}>?</span>
    </button>
  );
}

function renderInline(text: string): React.ReactNode[] {
  return text
    .split(/(`[^`]+`)/g)
    .filter(Boolean)
    .map((segment, idx) => {
      if (segment.startsWith("`") && segment.endsWith("`")) {
        return (
          <code key={`code-${idx}`} style={{ background: "#e2e8f0", padding: "2px 4px", borderRadius: 4 }}>
            {segment.slice(1, -1)}
          </code>
        );
      }
      return segment;
    });
}

function renderMarkdown(markdown: string): React.ReactNode {
  const lines = markdown.split(/\n/);
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      nodes.push(
        <ul key={`list-${nodes.length}`} style={{ margin: "12px 0", paddingLeft: 20 }}>
          {listBuffer.map((item, idx) => (
            <li key={`item-${idx}`} style={{ marginBottom: 6 }}>
              {renderInline(item.trim())}
            </li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    if (trimmed.startsWith("- ")) {
      listBuffer.push(trimmed.replace(/^\-\s+/, ""));
      return;
    }
    flushList();
    if (trimmed.startsWith("#")) {
      const level = Math.min(trimmed.match(/^#+/)?.[0].length ?? 1, 6);
      const tag = `h${level}` as keyof JSX.IntrinsicElements;
      nodes.push(
        React.createElement(
          tag,
          { key: `heading-${index}`, style: { marginTop: level === 1 ? 0 : 18, color: "#0f172a" } },
          renderInline(trimmed.replace(/^#+\s*/, ""))
        )
      );
      return;
    }
    nodes.push(
      <p key={`paragraph-${index}`} style={{ margin: "10px 0", lineHeight: 1.6 }}>
        {renderInline(line)}
      </p>
    );
  });

  flushList();
  return <>{nodes}</>;
}

function HelpCenter({ open, query, docs, filtered, activeSlug, onQueryChange, onClose, onSelectDoc }: HelpCenterProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const activeDoc = docs.find((doc) => doc.slug === activeSlug) ?? filtered[0] ?? null;

  return (
    <div
      style={overlayStyles}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Help Center" style={dialogStyles}>
        <div style={searchRowStyles}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search docs by endpoint, topic or keyword"
              style={{
                flex: 1,
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #cbd5f5",
                fontSize: 16
              }}
            />
            <span style={{ fontSize: 12, color: "#475569" }}>Press Esc to close</span>
          </div>
        </div>
        <div style={helpBodyStyles}>
          <div style={listStyles}>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, color: "#64748b" }}>No matches for “{query}”.</div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {filtered.map((doc) => {
                  const isActive = doc.slug === activeDoc?.slug;
                  return (
                    <li key={doc.slug}>
                      <button
                        type="button"
                        onClick={() => onSelectDoc(doc.slug)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: "14px 18px",
                          background: isActive ? "#e0f2fe" : "transparent",
                          border: "none",
                          borderBottom: "1px solid #e2e8f0",
                          cursor: "pointer"
                        }}
                      >
                        <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 4 }}>{doc.title}</div>
                        <div style={{ fontSize: 13, color: "#475569" }}>{doc.summary}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div style={docStyles}>
            {activeDoc ? (
              <article>
                <header style={{ marginBottom: 12 }}>
                  <h2 style={{ margin: 0, fontSize: 22 }}>{activeDoc.title}</h2>
                  <p style={{ margin: "6px 0", color: "#475569" }}>{activeDoc.summary}</p>
                </header>
                <div style={{ color: "#1e293b" }}>{renderMarkdown(activeDoc.body)}</div>
              </article>
            ) : (
              <div style={{ color: "#64748b" }}>Select a result to read its details.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [helpDocs, setHelpDocs] = useState<HelpDoc[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpQuery, setHelpQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/help-index.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load help index: ${response.status}`);
        }
        return (await response.json()) as HelpIndexPayload;
      })
      .then((payload) => {
        if (!cancelled && Array.isArray(payload.docs)) {
          setHelpDocs(payload.docs);
        }
      })
      .catch((error) => {
        console.warn("Unable to load help index", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openHelp = useCallback((slug?: string) => {
    setHelpOpen(true);
    setHelpQuery((current) => (slug ? "" : current));
    setPendingSlug(slug ?? null);
  }, []);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    setHelpQuery("");
    setPendingSlug(null);
  }, []);

  const filteredDocs = useMemo(() => {
    const query = helpQuery.trim().toLowerCase();
    if (!query) {
      return helpDocs;
    }
    return helpDocs.filter((doc) => {
      const haystack = [doc.title, doc.summary, doc.plainText, doc.headings.join(" ")].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [helpDocs, helpQuery]);

  useEffect(() => {
    if (!helpOpen) return;
    if (pendingSlug) {
      setActiveSlug(pendingSlug);
      setPendingSlug(null);
      return;
    }
    if (activeSlug && filteredDocs.some((doc) => doc.slug === activeSlug)) {
      return;
    }
    if (filteredDocs.length > 0) {
      setActiveSlug(filteredDocs[0].slug);
    }
  }, [helpOpen, pendingSlug, filteredDocs, activeSlug]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.key === "?" || (event.key === "/" && event.shiftKey)) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openHelp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openHelp]);

  const handleSelectDoc = useCallback((slug: string) => {
    setActiveSlug(slug);
  }, []);

  return (
    <div style={appStyles}>
      <header style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 32 }}>APGMS Console</h1>
            <p style={{ margin: "6px 0", color: "#475569" }}>
              Orchestrate reconciliations and releases with API-level guardrails.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openHelp()}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #2563eb",
              background: "#2563eb",
              color: "white",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 25px rgba(37, 99, 235, 0.2)"
            }}
          >
            Open Help Center <span style={{ opacity: 0.8, marginLeft: 8 }}>(Shift + /)</span>
          </button>
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          marginBottom: 32
        }}
      >
        <div style={cardStyles}>
          <h2 style={{ marginTop: 0 }}>Release readiness</h2>
          <p style={{ lineHeight: 1.6 }}>
            Check <HelpTip term="RPT" slug="rpt" onOpen={openHelp} /> validity before triggering releases and keep your
            operators aligned on the current period state.
          </p>
        </div>
        <div style={cardStyles}>
          <h2 style={{ marginTop: 0 }}>Funding sweeps</h2>
          <p style={{ lineHeight: 1.6 }}>
            Prefund the one-way account by scheduling <HelpTip term="PayTo" slug="payto" onOpen={openHelp} /> sweeps and monitor
            settlement webhooks for delays.
          </p>
        </div>
        <div style={cardStyles}>
          <h2 style={{ marginTop: 0 }}>Audit trail</h2>
          <p style={{ lineHeight: 1.6 }}>
            Keep <HelpTip term="Evidence" slug="evidence" onOpen={openHelp} /> bundles ready for auditors with snapshots of your
            ledger movements.
          </p>
        </div>
      </section>

      <section style={cardStyles}>
        <h2 style={{ marginTop: 0 }}>Next steps</h2>
        <p style={{ lineHeight: 1.6 }}>
          Track <HelpTip term="Releases" slug="releases" onOpen={openHelp} /> as they progress from initiation to settlement and
          reconcile balances with upstream statements.
        </p>
      </section>

      <HelpCenter
        open={helpOpen}
        query={helpQuery}
        docs={helpDocs}
        filtered={filteredDocs}
        activeSlug={activeSlug}
        onQueryChange={setHelpQuery}
        onClose={closeHelp}
        onSelectDoc={handleSelectDoc}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
