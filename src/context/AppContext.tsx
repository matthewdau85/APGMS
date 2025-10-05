import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getBalance } from "../api/client";

type AppState = {
  abn: string;
  balance?: number;
};

const Ctx = createContext<AppState>({ abn: "11122233344" });

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({ abn: "11122233344" });

  useEffect(() => {
    getBalance(state.abn)
      .then((b) => setState((s) => ({ ...s, balance: b.balance })))
      .catch(() => void 0);
  }, [state.abn]);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
