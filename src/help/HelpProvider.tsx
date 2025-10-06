import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import HelpCenter from "./HelpCenter";

export type HelpDoc = {
  slug: string;
  title: string;
  summary?: string;
  modes?: string[];
  content: string;
  updatedAt?: string;
};

export type HelpPane = "search" | "whatsNew";

export interface HelpOpenOptions {
  query?: string;
  pane?: HelpPane;
  docSlug?: string;
}

export interface HelpContextValue {
  isOpen: boolean;
  open: (options?: HelpOpenOptions) => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (value: string) => void;
  contextKey?: string;
  contextQuery?: string;
  setContextKey: (key?: string, options?: { mode?: string }) => void;
  docs: HelpDoc[];
  isLoadingDocs: boolean;
  whatsNew: string;
  isLoadingChangelog: boolean;
  mode: string;
  setMode: (mode: string) => void;
  pane: HelpPane;
  setPane: (pane: HelpPane) => void;
  activeDocSlug?: string;
  setActiveDocSlug: (slug?: string) => void;
}

const HelpContext = createContext<HelpContextValue | undefined>(undefined);

const HELP_INDEX_PATH = "/help/help-index.json";
const CHANGELOG_PATH = "/CHANGELOG.md";

export function HelpCenterProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [contextKey, setContextKeyState] = useState<string | undefined>();
  const [contextQuery, setContextQuery] = useState<string | undefined>();
  const [docs, setDocs] = useState<HelpDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(true);
  const [whatsNew, setWhatsNew] = useState("");
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(true);
  const [mode, setMode] = useState("web");
  const [pane, setPane] = useState<HelpPane>("search");
  const [activeDocSlug, setActiveDocSlug] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    async function loadDocs() {
      try {
        setIsLoadingDocs(true);
        const response = await fetch(HELP_INDEX_PATH, { cache: "no-cache" });
        if (!response.ok) throw new Error(`Unable to load ${HELP_INDEX_PATH}`);
        const payload = (await response.json()) as { docs?: HelpDoc[] };
        if (!cancelled) {
          setDocs(payload.docs ?? []);
        }
      } catch (error) {
        console.error("Failed to load help index", error);
        if (!cancelled) {
          setDocs([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDocs(false);
        }
      }
    }
    loadDocs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadChangelog() {
      try {
        setIsLoadingChangelog(true);
        const response = await fetch(CHANGELOG_PATH, { cache: "no-cache" });
        if (!response.ok) throw new Error(`Unable to load ${CHANGELOG_PATH}`);
        const text = await response.text();
        if (!cancelled) {
          setWhatsNew(text);
        }
      } catch (error) {
        console.error("Failed to load changelog", error);
        if (!cancelled) {
          setWhatsNew("No changelog entries available.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingChangelog(false);
        }
      }
    }
    loadChangelog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!contextKey) {
      setContextQuery(undefined);
      return;
    }
    const queryFromKey = contextKey
      .split(/[._]/)
      .filter(Boolean)
      .join(" ");
    setContextQuery(queryFromKey);
  }, [contextKey]);

  useEffect(() => {
    if (!contextKey || !docs.length) return;
    const normalized = normalize(contextKey);
    const match = docs.find((doc) => {
      const haystack = `${doc.slug} ${doc.title} ${doc.summary ?? ""}`;
      return normalize(haystack).includes(normalized);
    });
    if (match) {
      setActiveDocSlug(match.slug);
    }
  }, [contextKey, docs]);

  const open = useCallback(
    (options?: HelpOpenOptions) => {
      const targetPane = options?.pane ?? "search";
      setPane(targetPane);
      if (options?.query !== undefined) {
        setQuery(options.query);
      } else if (options?.docSlug) {
        const doc = docs.find((entry) => entry.slug === options.docSlug);
        setQuery(doc?.title ?? options.docSlug);
      } else if (contextQuery) {
        setQuery(contextQuery);
      }
      if (options?.docSlug) {
        setActiveDocSlug(options.docSlug);
      } else if (contextKey && targetPane === "search") {
        const normalized = normalize(contextKey);
        const matchedDoc = docs.find((doc) => normalize(doc.slug).includes(normalized));
        if (matchedDoc) {
          setActiveDocSlug(matchedDoc.slug);
        }
      }
      setIsOpen(true);
    },
    [contextKey, contextQuery, docs]
  );

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((value) => !value);
  }, []);

  const registerContext = useCallback(
    (key?: string, options?: { mode?: string }) => {
      setContextKeyState(key);
      if (options?.mode) {
        setMode(options.mode);
      }
    },
    []
  );

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const isShiftSlash = event.code === "Slash" && event.shiftKey;
      const isQuestion = event.key === "?";
      if (isShiftSlash || isQuestion) {
        event.preventDefault();
        open();
      }
      if (event.key === "Escape") {
        if (isOpen) {
          event.preventDefault();
          close();
        }
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open, close, isOpen]);

  const value = useMemo<HelpContextValue>(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      query,
      setQuery,
      contextKey,
      contextQuery,
      setContextKey: registerContext,
      docs,
      isLoadingDocs,
      whatsNew,
      isLoadingChangelog,
      mode,
      setMode,
      pane,
      setPane,
      activeDocSlug,
      setActiveDocSlug,
    }),
    [
      isOpen,
      open,
      close,
      toggle,
      query,
      contextKey,
      contextQuery,
      registerContext,
      docs,
      isLoadingDocs,
      whatsNew,
      isLoadingChangelog,
      mode,
      pane,
      activeDocSlug,
    ]
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      <HelpCenter />
    </HelpContext.Provider>
  );
}

export function useHelpCenter(): HelpContextValue {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error("useHelpCenter must be used within HelpCenterProvider");
  }
  return context;
}

export function useContextHelp(key?: string, options?: { mode?: string }) {
  const { setContextKey } = useHelpCenter();
  useEffect(() => {
    setContextKey(key, options);
  }, [key, options?.mode, setContextKey]);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
