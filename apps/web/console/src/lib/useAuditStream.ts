import { useEffect, useRef, useState } from "react";
import { streamAuditLog } from "../api/client";
import type { AuditEntry } from "../api/schema";

export function useAuditStream(enabled: boolean) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsStreaming(true);
    setError(null);

    streamAuditLog(abortController.signal, (entry) => {
      setEntries((prev) => [entry, ...prev].slice(0, 100));
    })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsStreaming(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [enabled]);

  return { entries, isStreaming, error };
}
