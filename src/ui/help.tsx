import React from "react";

export type PageMeta = {
  title: string;
  helpSlug: string;
};

type HelpContextValue = {
  meta: PageMeta | null;
  register: (meta: PageMeta | null) => void;
  open: () => void;
  close: () => void;
  isOpen: boolean;
};

const HelpContext = React.createContext<HelpContextValue | undefined>(undefined);

export function useHelp() {
  const value = React.useContext(HelpContext);
  if (!value) {
    throw new Error("useHelp must be used within a HelpProvider");
  }
  return value;
}

export function HelpProvider({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = React.useState<PageMeta | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const register = React.useCallback((next: PageMeta | null) => {
    setMeta(next);
    setIsOpen(false);
  }, []);

  const open = React.useCallback(() => {
    if (meta) {
      setIsOpen(true);
    }
  }, [meta]);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = React.useMemo<HelpContextValue>(
    () => ({ meta, register, open, close, isOpen }),
    [meta, register, open, close, isOpen]
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}
