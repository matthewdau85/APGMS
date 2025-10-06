import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import helpIndexData from "./HelpIndex.json";
import { HelpIndex, HelpTopic, WhatsNewEntry } from "./types";

interface HelpContextValue {
  index: HelpIndex;
  isOpen: boolean;
  query: string;
  setQuery: (value: string) => void;
  activeTags: string[];
  activeModes: string[];
  results: HelpTopic[];
  whatsNew: WhatsNewEntry[];
  openDrawer: () => void;
  closeDrawer: () => void;
  openWithTag: (tag: string) => void;
  openWithMode: (mode: string) => void;
  toggleTag: (tag: string) => void;
  toggleMode: (mode: string) => void;
  clearFilters: () => void;
}

const HelpContext = createContext<HelpContextValue | null>(null);
const index = helpIndexData as HelpIndex;

function normalize(value: string) {
  return value.toLowerCase();
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [activeModes, setActiveModes] = useState<string[]>([]);

  const openDrawer = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
  }, []);

  const openWithTag = useCallback((tag: string) => {
    setActiveTags((prev) => (prev.includes(tag) ? prev : [tag]));
    setActiveModes([]);
    setQuery("");
    setIsOpen(true);
  }, []);

  const openWithMode = useCallback((mode: string) => {
    setActiveModes([mode]);
    setActiveTags([]);
    setQuery("");
    setIsOpen(true);
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    );
  }, []);

  const toggleMode = useCallback((mode: string) => {
    setActiveModes((prev) =>
      prev.includes(mode) ? prev.filter((item) => item !== mode) : [...prev, mode]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setActiveTags([]);
    setActiveModes([]);
    setQuery("");
  }, []);

  const results = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return index.topics.filter((topic) => {
      if (activeTags.length && !activeTags.every((tag) => topic.tags.includes(tag))) {
        return false;
      }
      if (
        activeModes.length &&
        !activeModes.some((mode) => topic.modes.map(normalize).includes(normalize(mode)))
      ) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        topic.title,
        topic.summary,
        topic.body,
        topic.tags.join(" "),
        topic.modes.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, activeTags, activeModes]);

  const value: HelpContextValue = {
    index,
    isOpen,
    query,
    setQuery,
    activeTags,
    activeModes,
    results,
    whatsNew: index.whatsNew,
    openDrawer,
    closeDrawer,
    openWithTag,
    openWithMode,
    toggleTag,
    toggleMode,
    clearFilters,
  };

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelpContext() {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    throw new Error("useHelpContext must be used within HelpProvider");
  }
  return ctx;
}
