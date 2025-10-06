import React, { createContext, useContext, useMemo, useState } from "react";

export type PageMeta = {
  title: string;
  description?: string;
  helpSlug: string;
  route: string;
};

type HelpContextValue = {
  pageMeta?: PageMeta;
  setPageMeta: (meta?: PageMeta) => void;
};

const HelpContext = createContext<HelpContextValue | undefined>(undefined);

export function HelpContextProvider({ children }: { children: React.ReactNode }) {
  const [pageMeta, setPageMeta] = useState<PageMeta | undefined>(undefined);

  const value = useMemo(
    () => ({
      pageMeta,
      setPageMeta,
    }),
    [pageMeta]
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelpContext() {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error("useHelpContext must be used within a HelpContextProvider");
  }
  return context;
}
