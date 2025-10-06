import React, { useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

type Provider = {
  id: string;
  name: string;
  category: "Payroll" | "Point of sale";
};

type ProviderApiError = Error & { requestId?: string };

const makeRequestId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
};

function simulateProviderFetch(attempt: number): Promise<Provider[]> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (attempt === 0) {
        const requestId = makeRequestId();
        const error: ProviderApiError = Object.assign(
          new Error("The integrations catalogue timed out."),
          { requestId }
        );
        reject(error);
        return;
      }

      resolve([
        { id: "myob", name: "MYOB Payroll", category: "Payroll" },
        { id: "quickbooks", name: "QuickBooks Payroll", category: "Payroll" },
        { id: "square", name: "Square", category: "Point of sale" },
        { id: "vend", name: "Vend", category: "Point of sale" },
      ]);
    }, 600);
  });
}

export default function Integrations() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [requestId, setRequestId] = useState<string>(makeRequestId());
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    simulateProviderFetch(attempt)
      .then((data) => {
        if (cancelled) return;
        setProviders(data);
        setStatus("ready");
        setErrorMessage("");
      })
      .catch((err: ProviderApiError) => {
        if (cancelled) return;
        const id = err.requestId ?? makeRequestId();
        setRequestId(id);
        setErrorMessage(err.message || "The integrations service is unavailable.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setAttempt((prev) => prev + 1);
    setRequestId(makeRequestId());
  };

  return (
    <div className="main-card space-y-6">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30 }}>Integrations</h1>

      {status === "loading" && (
        <LoadingState label="Checking available payroll and point-of-sale integrations" />
      )}

      {status === "error" && (
        <ErrorState
          body={`${errorMessage} Retry in a moment or share the request ID with support if it keeps happening.`}
          requestId={requestId}
          actionLabel="Try again"
          onAction={retry}
        />
      )}

      {status === "ready" && providers.length === 0 && (
        <EmptyState
          title="No integrations connected"
          body="Connect your payroll and point-of-sale systems so PAYGW and GST data stays in sync."
          ctaLabel="Request an integration"
          onCta={() => alert("We'll reach out to your vendor within one business day.")}
        />
      )}

      {status === "ready" && providers.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Connect trusted providers so APGMS can automatically reconcile PAYGW and GST activity.
          </p>
          <ul className="space-y-3">
            {providers.map((provider) => (
              <li
                key={provider.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="font-semibold text-slate-800">{provider.name}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{provider.category}</p>
                </div>
                <button className="button" style={{ marginLeft: 12 }}>
                  Connect
                </button>
              </li>
            ))}
          </ul>
          <EmptyState
            title="Need another provider?"
            body="Tell us what system you use and we'll notify you as soon as the integration is certified."
            ctaLabel="Suggest a provider"
            onCta={() => alert("Thanks! We'll prioritise your request and keep you updated.")}
          />
        </div>
      )}
    </div>
  );
}
