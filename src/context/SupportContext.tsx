import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getHelpArticleById, helpArticles } from "../support/helpContent";

type HelpState = {
  isOpen: boolean;
  query: string;
  activeArticleId: string | null;
};

type OpenHelpOptions = {
  query?: string;
  articleId?: string;
};

type SupportContextValue = {
  help: HelpState & { articleCount: number };
  openHelpCenter: (options?: OpenHelpOptions) => void;
  closeHelpCenter: () => void;
  setHelpQuery: (query: string) => void;
  setActiveHelpArticle: (id: string | null) => void;
  whatsNewOpen: boolean;
  openWhatsNew: () => void;
  closeWhatsNew: () => void;
};

const SupportContext = createContext<SupportContextValue | undefined>(undefined);

export function SupportProvider({ children }: { children: React.ReactNode }) {
  const [helpState, setHelpState] = useState<HelpState>({
    isOpen: false,
    query: "",
    activeArticleId: null,
  });
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const openHelpCenter = useCallback((options?: OpenHelpOptions) => {
    setHelpState((prev) => {
      const article = options?.articleId ? getHelpArticleById(options.articleId) : null;
      const derivedQuery = article ? article.keywords.join(" ") || article.title : prev.query;
      return {
        isOpen: true,
        query: options?.query ?? derivedQuery ?? "",
        activeArticleId: options?.articleId ?? article?.id ?? prev.activeArticleId ?? null,
      };
    });
  }, []);

  const closeHelpCenter = useCallback(() => {
    setHelpState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const setHelpQuery = useCallback((query: string) => {
    setHelpState((prev) => ({ ...prev, query }));
  }, []);

  const setActiveHelpArticle = useCallback((id: string | null) => {
    setHelpState((prev) => ({ ...prev, activeArticleId: id }));
  }, []);

  const openWhatsNew = useCallback(() => {
    setWhatsNewOpen(true);
  }, []);

  const closeWhatsNew = useCallback(() => {
    setWhatsNewOpen(false);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.shiftKey && (event.key === "?" || event.key === "/")) {
        event.preventDefault();
        openHelpCenter();
      }
      if (event.key === "Escape") {
        if (helpState.isOpen) {
          event.preventDefault();
          closeHelpCenter();
        } else if (whatsNewOpen) {
          event.preventDefault();
          closeWhatsNew();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [helpState.isOpen, whatsNewOpen, openHelpCenter, closeHelpCenter, closeWhatsNew]);

  const value = useMemo<SupportContextValue>(() => ({
    help: { ...helpState, articleCount: helpArticles.length },
    openHelpCenter,
    closeHelpCenter,
    setHelpQuery,
    setActiveHelpArticle,
    whatsNewOpen,
    openWhatsNew,
    closeWhatsNew,
  }), [helpState, openHelpCenter, closeHelpCenter, setHelpQuery, setActiveHelpArticle, whatsNewOpen, openWhatsNew, closeWhatsNew]);

  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

export function useSupport() {
  const ctx = useContext(SupportContext);
  if (!ctx) {
    throw new Error("useSupport must be used within a SupportProvider");
  }
  return ctx;
}
