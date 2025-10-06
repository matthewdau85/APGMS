import React, { useEffect, useMemo } from "react";
import { HelpDoc, useHelpCenter } from "./HelpProvider";

const drawerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: "28rem",
  backgroundColor: "#ffffff",
  boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.15)",
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  zIndex: 1000,
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.4)",
  zIndex: 999,
};

const tabButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  border: "1px solid #d1d5db",
  background: "#f8fafc",
  cursor: "pointer",
  fontWeight: 600,
};

const activeTabStyle: React.CSSProperties = {
  ...tabButtonStyle,
  background: "#0f766e",
  color: "#ffffff",
  borderColor: "#0f766e",
};

export default function HelpCenter() {
  const {
    isOpen,
    close,
    query,
    setQuery,
    docs,
    isLoadingDocs,
    whatsNew,
    isLoadingChangelog,
    pane,
    setPane,
    mode,
    activeDocSlug,
    setActiveDocSlug,
  } = useHelpCenter();

  const normalizedQuery = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!docs.length) return [] as Array<{ doc: HelpDoc; score: number }>;
    return docs
      .filter((doc) => {
        if (doc.modes && doc.modes.length > 0 && !doc.modes.includes(mode)) {
          return false;
        }
        if (!normalizedQuery) {
          return true;
        }
        const haystack = `${doc.title} ${doc.summary ?? ""} ${doc.content}`.toLowerCase();
        return normalizedQuery.split(/\s+/).every((term) => haystack.includes(term));
      })
      .map((doc) => ({ doc, score: scoreDoc(doc, normalizedQuery) }))
      .sort((a, b) => b.score - a.score);
  }, [docs, mode, normalizedQuery]);

  const activeDoc = useMemo(() => {
    const selected = results.find((entry) => entry.doc.slug === activeDocSlug)?.doc;
    if (selected) return selected;
    return results[0]?.doc;
  }, [results, activeDocSlug]);

  useEffect(() => {
    if (!isOpen) return;
    if (results.length === 0) {
      setActiveDocSlug(undefined);
      return;
    }
    if (!activeDoc) {
      setActiveDocSlug(results[0].doc.slug);
    }
  }, [isOpen, results, activeDoc, setActiveDocSlug]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div style={overlayStyle} onClick={close} />
      <aside style={drawerStyle} role="dialog" aria-modal="true" aria-label="Help Center">
        <header style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>Help Center</h2>
          <button
            type="button"
            onClick={close}
            style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer" }}
            aria-label="Close help center"
          >
            ×
          </button>
        </header>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setPane("search")}
            style={pane === "search" ? activeTabStyle : tabButtonStyle}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => setPane("whatsNew")}
            style={pane === "whatsNew" ? activeTabStyle : tabButtonStyle}
          >
            What’s New
          </button>
        </div>

        {pane === "search" ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search help articles"
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5f5",
                  fontSize: 14,
                }}
              />
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Press Shift + / for quick access</div>
            </div>

            {isLoadingDocs ? (
              <p style={{ fontSize: 14, color: "#475569" }}>Loading documentation…</p>
            ) : results.length === 0 ? (
              <p style={{ fontSize: 14, color: "#475569" }}>
                {normalizedQuery
                  ? `No help topics matched “${query}”.`
                  : "No help topics available for the current mode."}
              </p>
            ) : (
              <div style={{ display: "flex", gap: 12, flex: 1, overflow: "hidden" }}>
                <nav style={{ width: "45%", overflowY: "auto", borderRight: "1px solid #e2e8f0" }}>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {results.map(({ doc }) => (
                      <li key={doc.slug}>
                        <button
                          type="button"
                          onClick={() => setActiveDocSlug(doc.slug)}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "10px 8px",
                            border: "none",
                            background: doc.slug === activeDoc?.slug ? "#ecfeff" : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{doc.title}</div>
                          {doc.summary ? (
                            <div style={{ fontSize: 12, color: "#475569" }}>{doc.summary}</div>
                          ) : null}
                          {doc.updatedAt ? (
                            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                              Updated {doc.updatedAt}
                            </div>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
                <article
                  style={{ flex: 1, overflowY: "auto", paddingRight: 4 }}
                  aria-live="polite"
                  aria-label={activeDoc?.title ?? "Help details"}
                >
                  {activeDoc ? renderDoc(activeDoc) : null}
                </article>
              </div>
            )}
          </>
        ) : (
          <section style={{ flex: 1, overflowY: "auto" }}>
            {isLoadingChangelog ? (
              <p style={{ fontSize: 14, color: "#475569" }}>Loading release notes…</p>
            ) : (
              <pre
                style={{
                  background: "#f8fafc",
                  padding: 12,
                  borderRadius: 8,
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {whatsNew}
              </pre>
            )}
          </section>
        )}
      </aside>
    </>
  );
}

function scoreDoc(doc: HelpDoc, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const haystack = `${doc.title} ${doc.summary ?? ""}`.toLowerCase();
  let score = 0;
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (doc.slug.toLowerCase().includes(term)) score += 4;
    if (doc.title.toLowerCase().includes(term)) score += 6;
    if ((doc.summary ?? "").toLowerCase().includes(term)) score += 3;
    if (doc.content.toLowerCase().includes(term)) score += 1;
  }
  if (normalizedQuery && haystack.startsWith(normalizedQuery)) {
    score += 10;
  }
  return score;
}

function renderDoc(doc: HelpDoc) {
  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{doc.title}</h3>
      {doc.summary ? (
        <p style={{ fontSize: 13, color: "#475569", marginBottom: 12 }}>{doc.summary}</p>
      ) : null}
      <DocBody content={doc.content} />
    </div>
  );
}

function DocBody({ content }: { content: string }) {
  const blocks = useMemo(() => content.split(/\n\n+/), [content]);
  return (
    <div style={{ fontSize: 13, color: "#0f172a", lineHeight: 1.6 }}>
      {blocks.map((block, index) => {
        if (block.startsWith("## ")) {
          return (
            <h4 key={index} style={{ fontSize: 15, fontWeight: 700, marginTop: 16 }}>
              {block.replace(/^##\s+/, "")}
            </h4>
          );
        }
        if (block.startsWith("### ")) {
          return (
            <h5 key={index} style={{ fontSize: 14, fontWeight: 700, marginTop: 12 }}>
              {block.replace(/^###\s+/, "")}
            </h5>
          );
        }
        if (block.trim().startsWith("- ")) {
          const items = block.split(/\n/).map((line) => line.replace(/^-\s*/, ""));
          return (
            <ul key={index} style={{ paddingLeft: 18, marginBottom: 12 }}>
              {items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }
        if (block.trim().match(/^\d+\.\s/)) {
          const items = block.split(/\n/).map((line) => line.replace(/^\d+\.\s*/, ""));
          return (
            <ol key={index} style={{ paddingLeft: 18, marginBottom: 12 }}>
              {items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ol>
          );
        }
        if (block.trim().startsWith(">")) {
          return (
            <blockquote
              key={index}
              style={{
                borderLeft: "3px solid #0f766e",
                paddingLeft: 12,
                color: "#0f172a",
                fontStyle: "italic",
                marginBottom: 12,
              }}
            >
              {block.replace(/^>\s*/, "")}
            </blockquote>
          );
        }
        if (block.includes("|") && block.includes("---")) {
          return (
            <pre
              key={index}
              style={{
                background: "#f1f5f9",
                padding: 12,
                borderRadius: 8,
                overflowX: "auto",
                marginBottom: 12,
              }}
            >
              {block}
            </pre>
          );
        }
        return (
          <p key={index} style={{ marginBottom: 12 }}>
            {block}
          </p>
        );
      })}
    </div>
  );
}
