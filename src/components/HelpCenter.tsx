import React, { useEffect, useMemo, useRef } from "react";
import { useSupport } from "../context/SupportContext";
import { HelpArticle, helpArticles, getHelpArticleById } from "../support/helpContent";

function buildSearchIndex(article: HelpArticle) {
  const haystack = [
    article.title,
    article.summary,
    article.body.join(" "),
    article.keywords.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  return haystack;
}

const indexedArticles = helpArticles.map((article) => ({
  article,
  haystack: buildSearchIndex(article),
}));

export default function HelpCenter() {
  const { help, closeHelpCenter, setHelpQuery, setActiveHelpArticle } = useSupport();
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (help.isOpen) {
      const id = window.requestAnimationFrame(() => searchRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [help.isOpen]);

  const trimmedQuery = help.query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!trimmedQuery) {
      return indexedArticles;
    }
    const parts = trimmedQuery.split(/\s+/).filter(Boolean);
    return indexedArticles.filter(({ haystack }) =>
      parts.every((token) => haystack.includes(token))
    );
  }, [trimmedQuery]);

  const activeArticle = useMemo(() => {
    const candidate = help.activeArticleId ? getHelpArticleById(help.activeArticleId) : null;
    if (candidate) {
      return candidate;
    }
    return filtered[0]?.article ?? helpArticles[0] ?? null;
  }, [help.activeArticleId, filtered]);

  const visibleArticles = useMemo(() => {
    if (!activeArticle) {
      return filtered.map(({ article }) => article);
    }
    const inFiltered = filtered.some(({ article }) => article.id === activeArticle.id);
    const list = filtered.map(({ article }) => article);
    if (!inFiltered) {
      return [activeArticle, ...list];
    }
    return list;
  }, [filtered, activeArticle]);

  if (!help.isOpen) {
    return null;
  }

  return (
    <div className="support-overlay" onClick={closeHelpCenter} role="dialog" aria-modal="true">
      <div className="support-panel" onClick={(event) => event.stopPropagation()}>
        <header className="support-header">
          <div>
            <h2 className="support-title">Help Center</h2>
            <p className="support-subtitle">
              {help.articleCount} guide{help.articleCount === 1 ? "" : "s"} · Shift + / to open · Esc to close
            </p>
          </div>
          <button className="support-close" onClick={closeHelpCenter} type="button">
            Close
          </button>
        </header>
        <div className="support-body">
          <aside className="help-sidebar">
            <input
              ref={searchRef}
              value={help.query}
              onChange={(event) => setHelpQuery(event.target.value)}
              placeholder="Search help articles"
              className="help-search"
              aria-label="Search help articles"
            />
            <div className="help-results" role="list">
              {visibleArticles.length === 0 && (
                <div className="help-empty" role="status">
                  No help topics match "{help.query}".
                </div>
              )}
              {visibleArticles.map((article) => {
                const isActive = activeArticle?.id === article.id;
                return (
                  <button
                    key={article.id}
                    type="button"
                    className={isActive ? "help-result active" : "help-result"}
                    onClick={() => setActiveHelpArticle(article.id)}
                  >
                    <span className="help-result-title">{article.title}</span>
                    <span className="help-result-summary">{article.summary}</span>
                  </button>
                );
              })}
            </div>
          </aside>
          <section className="help-article" aria-live="polite">
            {activeArticle ? (
              <div>
                <h3>{activeArticle.title}</h3>
                <p className="help-article-summary">{activeArticle.summary}</p>
                {activeArticle.body.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
                {activeArticle.links && activeArticle.links.length > 0 && (
                  <div className="help-links">
                    <h4>Related documentation</h4>
                    <ul>
                      {activeArticle.links.map((link) => (
                        <li key={link.href}>
                          <a href={link.href}>{link.label}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p>Select a help topic to get started.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
