import React, { useEffect, useMemo, useState } from "react";
import { useSupport } from "../context/SupportContext";

type Section = {
  title: string;
  bullets: string[];
  paragraphs: string[];
};

function getPublicPath(): string {
  const fromMeta = typeof import.meta !== "undefined" && (import.meta as any)?.env?.BASE_URL;
  const fromEnv = (process.env.PUBLIC_URL as string | undefined) ?? "";
  const base = (fromMeta || fromEnv || "").replace(/\/$/, "");
  return `${base}/CHANGELOG.md`.replace(/\/\//g, "/");
}

function parseChangelog(markdown: string): Section[] {
  const lines = markdown.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) {
        sections.push(current);
      }
      current = { title: line.slice(3).trim(), bullets: [], paragraphs: [] };
      continue;
    }
    if (line.startsWith("# ")) {
      // Skip the main heading but make sure we have a section to attach content to.
      if (!current) {
        current = { title: line.slice(2).trim(), bullets: [], paragraphs: [] };
      }
      continue;
    }
    if (!current) {
      current = { title: "Latest updates", bullets: [], paragraphs: [] };
    }
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("- ")) {
      current.bullets.push(trimmed.slice(2).trim());
    } else {
      current.paragraphs.push(trimmed);
    }
  }
  if (current) {
    sections.push(current);
  }
  return sections;
}

export default function WhatsNewPanel() {
  const { whatsNewOpen, closeWhatsNew } = useSupport();
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!whatsNewOpen || content || loading) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    async function fetchChangelog() {
      try {
        setLoading(true);
        const response = await fetch(getPublicPath(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to load changelog: HTTP ${response.status}`);
        }
        const text = await response.text();
        if (!cancelled) {
          setContent(text);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Unable to load changelog");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchChangelog();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [whatsNewOpen, content, loading]);

  const sections = useMemo(() => (content ? parseChangelog(content) : []), [content]);

  if (!whatsNewOpen) {
    return null;
  }

  return (
    <div className="support-overlay" onClick={closeWhatsNew} role="dialog" aria-modal="true">
      <div className="whats-new-panel" onClick={(event) => event.stopPropagation()}>
        <header className="support-header">
          <div>
            <h2 className="support-title">What&apos;s New</h2>
            <p className="support-subtitle">Latest updates pulled from CHANGELOG.md</p>
          </div>
          <button className="support-close" onClick={closeWhatsNew} type="button">
            Close
          </button>
        </header>
        <div className="whats-new-body">
          {loading && <p>Loading updates…</p>}
          {error && !loading && <p className="whats-new-error">{error}</p>}
          {!loading && !error && sections.length === 0 && <p>No updates yet.</p>}
          {!loading && !error && sections.length > 0 && (
            <div className="whats-new-sections">
              {sections.map((section) => (
                <section key={section.title} className="whats-new-section">
                  <h3>{section.title}</h3>
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {section.bullets.length > 0 && (
                    <ul>
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
