import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useHelpContext } from "./HelpContext";
import { helpArticles } from "./helpArticles";

type HelpCenterProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function HelpCenter({ isOpen, onClose }: HelpCenterProps) {
  const { pageMeta } = useHelpContext();
  const [query, setQuery] = useState("");
  const [activeSlug, setActiveSlug] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    const defaultSlug = pageMeta?.helpSlug ?? helpArticles[0]?.slug;
    setActiveSlug(defaultSlug);
  }, [isOpen, pageMeta]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const filteredArticles = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) {
      return helpArticles;
    }
    return helpArticles.filter((article) => {
      return (
        article.title.toLowerCase().includes(search) ||
        article.body.toLowerCase().includes(search) ||
        article.summary.toLowerCase().includes(search)
      );
    });
  }, [query]);

  useEffect(() => {
    if (!filteredArticles.length) {
      return;
    }
    if (!activeSlug || !filteredArticles.some((article) => article.slug === activeSlug)) {
      setActiveSlug(filteredArticles[0].slug);
    }
  }, [filteredArticles, activeSlug]);

  if (!isOpen) {
    return null;
  }

  const activeArticle = filteredArticles.find((article) => article.slug === activeSlug) ?? filteredArticles[0];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="help-center-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="help-center">
        <header className="help-center__header">
          <div>
            <h2>Help Center</h2>
            {pageMeta?.title && (
              <p className="help-center__context">Context: {pageMeta.title}</p>
            )}
          </div>
          <button className="help-center__close" onClick={onClose} aria-label="Close help">
            ×
          </button>
        </header>

        <div className="help-center__search">
          <input
            autoFocus
            type="search"
            placeholder="Search help articles"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="help-center__shortcut">⇧ + /</span>
        </div>

        {filteredArticles.length === 0 ? (
          <div className="help-center__empty">No articles match "{query}".</div>
        ) : (
          <div className="help-center__content">
            <aside>
              <ul>
                {filteredArticles.map((article) => (
                  <li key={article.slug}>
                    <button
                      className={article.slug === activeArticle.slug ? "active" : ""}
                      onClick={() => setActiveSlug(article.slug)}
                    >
                      <span className="title">{article.title}</span>
                      <span className="summary">{article.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <article>
              <h3>{activeArticle.title}</h3>
              <p className="help-center__summary">{activeArticle.summary}</p>
              {activeArticle.body.split("\n\n").map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
              <a
                className="help-center__link"
                href={activeArticle.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in docs ↗
              </a>
            </article>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
