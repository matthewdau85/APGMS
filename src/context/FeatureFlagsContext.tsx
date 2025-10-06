import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type MlFlags = {
  global: boolean;
  recon_scorer: boolean;
  bank_matcher: boolean;
  forecast: boolean;
  invoice_ner: boolean;
};

type FeatureFlagsContextValue = {
  loading: boolean;
  ml: MlFlags;
  error?: string;
  refresh: () => void;
};

const defaultFlags: FeatureFlagsContextValue = {
  loading: true,
  ml: {
    global: false,
    recon_scorer: false,
    bank_matcher: false,
    forecast: false,
    invoice_ner: false,
  },
  refresh: () => undefined,
};

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>(defaultFlags);

export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [ml, setMl] = useState<MlFlags>(defaultFlags.ml);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/features");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const nextMl = data?.ml ?? {};
      setMl({
        global: Boolean(nextMl.global),
        recon_scorer: Boolean(nextMl.recon_scorer),
        bank_matcher: Boolean(nextMl.bank_matcher),
        forecast: Boolean(nextMl.forecast),
        invoice_ner: Boolean(nextMl.invoice_ner),
      });
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feature flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const value = useMemo<FeatureFlagsContextValue>(
    () => ({ loading, ml, error, refresh: load }),
    [loading, ml, error, load]
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagsContextValue {
  return useContext(FeatureFlagsContext);
}
