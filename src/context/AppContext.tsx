import { createContext, useContext, useEffect, useState } from "react";
import { getBalance } from "../api/client";

type AppState = { abn: string; periodId?: number; balance?: number };
const Ctx = createContext<AppState>({ abn: "11122233344", periodId: 1 });

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [s, setS] = useState<AppState>({ abn: "11122233344", periodId: 1 });

  useEffect(() => {
    getBalance(s.abn)
      .then((b) => setS((x) => ({ ...x, balance: b.balance })))
      .catch(() => void 0);
  }, [s.abn]);

  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}
export const useApp = () => useContext(Ctx);
