import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatDate } from "./formatters";

type SectionKey = "dashboard" | "bas" | "evidence";

type CommandAction = {
  id: string;
  label: string;
  description: string;
  onSelect: () => void;
};

const isEditableElement = (element: EventTarget | null): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const tagName = element.tagName;
  return (
    element.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
};

const CommandPalette: React.FC<{
  isOpen: boolean;
  label: string;
  placeholder: string;
  emptyLabel: (query: string) => string;
  actions: CommandAction[];
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
  closeLabel: string;
}> = ({
  isOpen,
  label,
  placeholder,
  emptyLabel,
  actions,
  onClose,
  inputRef,
  closeLabel,
}) => {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      setQuery("");
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const filtered = actions.filter((action) =>
    action.label.toLowerCase().includes(query.toLowerCase()) ||
    action.description.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (action: CommandAction) => {
    action.onSelect();
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2 id="command-palette-title" className="modal__title">
            {label}
          </h2>
          <button type="button" className="modal__close" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
        <label htmlFor="command-input" className="sr-only">
          {label}
        </label>
        <input
          id="command-input"
          ref={inputRef}
          className="command-input"
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && filtered[0]) {
              event.preventDefault();
              handleSelect(filtered[0]);
            }
          }}
        />
        {filtered.length === 0 ? (
          <p role="status">{emptyLabel(query)}</p>
        ) : (
          <ul className="command-list" role="listbox" aria-label={label}>
            {filtered.map((action) => (
              <li key={action.id} className="command-item">
                <button
                  type="button"
                  className="command-action"
                  onClick={() => handleSelect(action)}
                >
                  <span>{action.label}</span>
                  <span className="section-footer">{action.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const HelpModal: React.FC<{
  isOpen: boolean;
  title: string;
  subtitle: string;
  headers: { action: string; keys: string };
  rows: { action: string; keys: React.ReactNode }[];
  onClose: () => void;
  initialFocusRef: React.RefObject<HTMLButtonElement>;
  closeLabel: string;
}> = ({
  isOpen,
  title,
  subtitle,
  headers,
  rows,
  onClose,
  initialFocusRef,
  closeLabel,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <h2 id="help-modal-title" className="modal__title">
              {title}
            </h2>
            <p>{subtitle}</p>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            ref={initialFocusRef}
          >
            {closeLabel}
          </button>
        </div>
        <table className="keyboard-grid">
          <thead>
            <tr>
              <th scope="col">{headers.action}</th>
              <th scope="col">{headers.keys}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.action}>
                <td>{row.action}</td>
                <td>{row.keys}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SectionKey>("dashboard");
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const awaitingSectionKey = useRef(false);
  const awaitingTimeout = useRef<number | null>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedCommand = useRef<HTMLElement | null>(null);
  const previouslyFocusedHelp = useRef<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const metrics = useMemo(
    () => [
      {
        key: "lodgement",
        value: formatDate(new Date()),
        description: t("metrics.lodgement.description"),
      },
      {
        key: "gst",
        value: formatCurrency(12850.4),
        description: t("metrics.gst.description"),
      },
      {
        key: "evidence",
        value: "24 / 24",
        description: t("metrics.evidence.description"),
      },
    ],
    [t]
  );

  const announceSectionChange = useCallback(
    (section: SectionKey) => {
      const sectionName = t(`nav.${section}` as const);
      setAnnouncement(t("app.navigated", { section: sectionName }));
    },
    [t]
  );

  useEffect(() => {
    if (!announcement) {
      return;
    }
    const timeout = window.setTimeout(() => setAnnouncement(""), 1500);
    return () => window.clearTimeout(timeout);
  }, [announcement]);

  const handleNavigate = useCallback(
    (section: SectionKey) => {
      setActiveSection(section);
      announceSectionChange(section);
    },
    [announceSectionChange]
  );

  useEffect(() => {
    if (isCommandOpen) {
      previouslyFocusedCommand.current = document.activeElement as HTMLElement | null;
      const timeout = window.setTimeout(() => {
        commandInputRef.current?.focus();
      }, 0);
      document.body.style.overflow = "hidden";
      return () => {
        window.clearTimeout(timeout);
        if (!isHelpOpen) {
          document.body.style.overflow = "";
        }
        previouslyFocusedCommand.current?.focus();
      };
    }
    return;
  }, [isCommandOpen, isHelpOpen]);

  useEffect(() => {
    if (isHelpOpen) {
      previouslyFocusedHelp.current = document.activeElement as HTMLElement | null;
      const timeout = window.setTimeout(() => {
        helpCloseRef.current?.focus();
      }, 0);
      document.body.style.overflow = "hidden";
      return () => {
        window.clearTimeout(timeout);
        if (!isCommandOpen) {
          document.body.style.overflow = "";
        }
        previouslyFocusedHelp.current?.focus();
      };
    }
    return;
  }, [isHelpOpen, isCommandOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }

      if ((isCommandOpen || isHelpOpen) && event.key !== "Escape") {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen(true);
        awaitingSectionKey.current = false;
        if (awaitingTimeout.current) {
          window.clearTimeout(awaitingTimeout.current);
          awaitingTimeout.current = null;
        }
        return;
      }

      if (event.shiftKey && (event.key === "?" || event.key === "/")) {
        event.preventDefault();
        setIsHelpOpen(true);
        awaitingSectionKey.current = false;
        if (awaitingTimeout.current) {
          window.clearTimeout(awaitingTimeout.current);
          awaitingTimeout.current = null;
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "g") {
        awaitingSectionKey.current = true;
        event.preventDefault();
        if (awaitingTimeout.current) {
          window.clearTimeout(awaitingTimeout.current);
        }
        awaitingTimeout.current = window.setTimeout(() => {
          awaitingSectionKey.current = false;
          awaitingTimeout.current = null;
        }, 1500);
        return;
      }

      if (awaitingSectionKey.current) {
        awaitingSectionKey.current = false;
        if (awaitingTimeout.current) {
          window.clearTimeout(awaitingTimeout.current);
          awaitingTimeout.current = null;
        }
        const key = event.key.toLowerCase();
        if (key === "d") {
          event.preventDefault();
          handleNavigate("dashboard");
        } else if (key === "b") {
          event.preventDefault();
          handleNavigate("bas");
        } else if (key === "e") {
          event.preventDefault();
          handleNavigate("evidence");
        }
        return;
      }

      if (event.key === "Escape") {
        if (isCommandOpen) {
          event.preventDefault();
          setIsCommandOpen(false);
        }
        if (isHelpOpen) {
          event.preventDefault();
          setIsHelpOpen(false);
        }
        awaitingSectionKey.current = false;
        if (awaitingTimeout.current) {
          window.clearTimeout(awaitingTimeout.current);
          awaitingTimeout.current = null;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNavigate, isCommandOpen, isHelpOpen]);

  useEffect(() => {
    return () => {
      if (awaitingTimeout.current) {
        window.clearTimeout(awaitingTimeout.current);
      }
    };
  }, []);

  const commandActions: CommandAction[] = useMemo(
    () => [
      {
        id: "dashboard",
        label: t("nav.dashboard"),
        description: t("commandPalette.actions.dashboard"),
        onSelect: () => handleNavigate("dashboard"),
      },
      {
        id: "bas",
        label: t("nav.bas"),
        description: t("commandPalette.actions.bas"),
        onSelect: () => handleNavigate("bas"),
      },
      {
        id: "evidence",
        label: t("nav.evidence"),
        description: t("commandPalette.actions.evidence"),
        onSelect: () => handleNavigate("evidence"),
      },
      {
        id: "help",
        label: t("keyboard.help"),
        description: t("commandPalette.actions.help"),
        onSelect: () => setIsHelpOpen(true),
      },
    ],
    [handleNavigate, t]
  );

  const helpRows = useMemo(
    () => [
      {
        action: t("keyboard.commandPalette"),
        keys: (
          <span>
            <span>
              <kbd>⌘</kbd> or <kbd>Ctrl</kbd>
            </span>{" "}
            + <kbd>K</kbd>
          </span>
        ),
      },
      {
        action: t("keyboard.help"),
        keys: (
          <span>
            <kbd>Shift</kbd> + <kbd>/</kbd>
          </span>
        ),
      },
      {
        action: t("keyboard.dashboard"),
        keys: (
          <span>
            <kbd>G</kbd> then <kbd>D</kbd>
          </span>
        ),
      },
      {
        action: t("keyboard.bas"),
        keys: (
          <span>
            <kbd>G</kbd> then <kbd>B</kbd>
          </span>
        ),
      },
      {
        action: t("keyboard.evidence"),
        keys: (
          <span>
            <kbd>G</kbd> then <kbd>E</kbd>
          </span>
        ),
      },
    ],
    [t]
  );

  const lastUpdated = useMemo(() => formatDate(new Date()), []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("app.skipToContent")}
      </a>
      <header className="app-header" role="banner">
        <h1 className="app-header__title">{t("app.title")}</h1>
        <p>{t("app.tagline")}</p>
      </header>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <main id="main-content" className="app-main">
        <nav className="primary-nav" aria-label={t("nav.ariaLabel")}>
          <ul className="primary-nav__list">
            {(["dashboard", "bas", "evidence"] as SectionKey[]).map((sectionKey) => (
              <li key={sectionKey}>
                <a
                  href={`#${sectionKey}`}
                  className="primary-nav__link"
                  aria-current={activeSection === sectionKey ? "page" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    handleNavigate(sectionKey);
                  }}
                >
                  {t(`nav.${sectionKey}` as const)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <section
          className="section-card"
          id={activeSection}
          aria-labelledby={`${activeSection}-title`}
          role="region"
        >
          <div className="section-card__header">
            <h2 id={`${activeSection}-title`} className="section-card__title">
              {t(`sections.${activeSection}.title` as const)}
            </h2>
            <p>{t(`sections.${activeSection}.description` as const)}</p>
            <p className="section-footer">
              {t("app.lastUpdated", { date: lastUpdated })}
            </p>
          </div>
          <div
            className="status-grid"
            role="list"
            aria-label={t("app.statusGridLabel")}
          >
            {metrics.map((metric) => (
              <div key={metric.key} className="status-tile" role="listitem">
                <h3 className="status-tile__label">{t(`metrics.${metric.key}.label` as const)}</h3>
                <p className="status-tile__value">{metric.value}</p>
                <p className="status-tile__description">{metric.description}</p>
              </div>
            ))}
          </div>
          <p className="section-footer">
            {t(`sections.${activeSection}.footnote` as const)}
          </p>
        </section>
      </main>
      <CommandPalette
        isOpen={isCommandOpen}
        label={t("commandPalette.title")}
        placeholder={t("commandPalette.placeholder")}
        emptyLabel={(query) => t("commandPalette.empty", { query })}
        actions={commandActions}
        onClose={() => setIsCommandOpen(false)}
        inputRef={commandInputRef}
        closeLabel={t("common.close")}
      />
      <HelpModal
        isOpen={isHelpOpen}
        title={t("help.title")}
        subtitle={t("help.subtitle")}
        headers={{ action: t("help.table.action"), keys: t("help.table.keys") }}
        rows={helpRows}
        onClose={() => setIsHelpOpen(false)}
        initialFocusRef={helpCloseRef}
        closeLabel={t("common.close")}
      />
    </div>
  );
};

export default App;
