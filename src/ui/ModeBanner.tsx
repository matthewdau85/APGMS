import React, { useEffect, useState } from "react";

type ModeInfo = {
  appMode: string;
  simulated: boolean;
  dryRun: boolean;
};

const fallbackMode: ModeInfo = {
  appMode: "prototype",
  simulated: true,
  dryRun: false,
};

const parseBoolean = (value: string | null): boolean => {
  return value !== null && value.toLowerCase() === "true";
};

export default function ModeBanner() {
  const [mode, setMode] = useState<ModeInfo>(fallbackMode);

  useEffect(() => {
    let isMounted = true;

    const readModeFromHeaders = (response: Response) => {
      if (!isMounted) {
        return;
      }

      const appMode = response.headers.get("x-app-mode") ?? fallbackMode.appMode;
      const simulated = parseBoolean(response.headers.get("x-simulated"));
      const dryRun = parseBoolean(response.headers.get("x-dry-run"));

      setMode({
        appMode,
        simulated,
        dryRun,
      });
    };

    fetch("/health", { cache: "no-store" })
      .then(readModeFromHeaders)
      .catch(() => {
        if (isMounted) {
          setMode(fallbackMode);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const isRealMode = mode.appMode === "real";
  const isSimulated = mode.simulated;
  const bannerLabel = isRealMode
    ? "Live (Real)"
    : isSimulated
    ? "Prototype (Simulated)"
    : "Prototype";

  return (
    <>
      <div
        className={`mode-banner ${isRealMode ? "mode-live" : "mode-prototype"}`}
        role="status"
        aria-live="polite"
      >
        <span className="mode-label">{bannerLabel}</span>
        {isRealMode && isSimulated ? (
          <span className="mode-warning">Simulation flags active</span>
        ) : null}
      </div>
      {mode.dryRun ? <div className="dry-run-watermark">DRY RUN</div> : null}
    </>
  );
}
