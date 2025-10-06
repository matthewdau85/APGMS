import React from "react";
import { useHelp } from "../help/useHelp";

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function HelpDrawer() {
  const {
    isOpen,
    closeDrawer,
    query,
    setQuery,
    activeTags,
    activeModes,
    toggleTag,
    toggleMode,
    clearFilters,
    results,
    whatsNew,
    index,
  } = useHelp();

  if (!isOpen) {
    return null;
  }

  return (
    <div className="help-drawer-overlay" onClick={closeDrawer}>
      <aside
        className="help-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Product help"
      >
        <header className="help-drawer__header">
          <div>
            <h2>Need a hand?</h2>
            <p>Search topics, filter by workflow, or jump to release notes.</p>
          </div>
          <button className="help-close" type="button" onClick={closeDrawer} aria-label="Close help">
            ×
          </button>
        </header>

        <div className="help-search">
          <input
            type="search"
            placeholder="Search help"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query || activeTags.length || activeModes.length ? (
            <button className="help-clear" type="button" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        <section className="help-filter-section" aria-label="Modes">
          <h3>Modes</h3>
          <div className="help-chips">
            {index.modes.map((mode) => {
              const isActive = activeModes.includes(mode);
              return (
                <button
                  type="button"
                  key={mode}
                  className={isActive ? "help-chip active" : "help-chip"}
                  onClick={() => toggleMode(mode)}
                >
                  {mode}
                </button>
              );
            })}
          </div>
        </section>

        <section className="help-filter-section" aria-label="Tags">
          <h3>Tags</h3>
          <div className="help-chips">
            {index.tags.map((tag) => {
              const isActive = activeTags.includes(tag);
              return (
                <button
                  type="button"
                  key={tag}
                  className={isActive ? "help-chip active" : "help-chip"}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        </section>

        <section className="help-whats-new" aria-label="Latest updates">
          <h3>What’s New</h3>
          {whatsNew.slice(0, 3).map((entry) => (
            <article key={entry.id} className="help-card">
              <header>
                <h4>{entry.title}</h4>
                <span className="help-card__date">{formatDate(entry.date)}</span>
              </header>
              <p>{entry.summary}</p>
              <footer>
                <a href={`/help#${entry.slug}`} onClick={closeDrawer}>
                  Read more
                </a>
              </footer>
            </article>
          ))}
        </section>

        <section className="help-results" aria-label="Help topics">
          <h3>Topics</h3>
          {results.length === 0 ? (
            <p className="help-empty">No topics match the current filters.</p>
          ) : (
            results.map((topic) => (
              <article key={topic.id} className="help-card">
                <header>
                  <h4>{topic.title}</h4>
                  <span className="help-card__date">
                    {formatDate(topic.lastUpdated) || "Updated recently"}
                  </span>
                </header>
                <p>{topic.summary}</p>
                <div className="help-card__tags">
                  {topic.modes.map((mode) => (
                    <button
                      type="button"
                      key={`${topic.id}-mode-${mode}`}
                      className="help-chip"
                      onClick={() => toggleMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                  {topic.tags.map((tag) => (
                    <button
                      type="button"
                      key={`${topic.id}-tag-${tag}`}
                      className="help-chip"
                      onClick={() => toggleTag(tag)}
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
                <footer>
                  <a href={`/help#${topic.slug}`} onClick={closeDrawer}>
                    View details
                  </a>
                </footer>
              </article>
            ))
          )}
        </section>
      </aside>
    </div>
  );
}
