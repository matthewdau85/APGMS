import React, { useCallback, useEffect, useState } from "react";

import { ML, ModelAssignment } from "../../libs/mlClient";

type AlertRecord = {
  id: string;
  date: string;
  detail: string;
  suggestedAction: string;
  inputHash: string;
  startedAt: number;
};

type DecisionState = {
  status: "pending" | "saving" | "logged" | "error";
  message?: string;
};

const OPERATOR_HASH = "operator_demo_hash";

export default function Fraud() {
  const [alerts] = useState<AlertRecord[]>(() => {
    const started = Date.now();
    return [
      {
        id: "alert-paygw-20250602",
        date: "02/06/2025",
        detail: "PAYGW payment skipped (flagged)",
        suggestedAction: "hold_payment",
        inputHash: "alert:paygw:2025-06-02",
        startedAt: started,
      },
      {
        id: "alert-gst-20250516",
        date: "16/05/2025",
        detail: "GST transfer lower than usual",
        suggestedAction: "request_supporting_docs",
        inputHash: "alert:gst:2025-05-16",
        startedAt: started,
      },
    ];
  });

  const [assignment, setAssignment] = useState<ModelAssignment | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState<boolean>(true);
  const [decisionState, setDecisionState] = useState<Record<string, DecisionState>>({});

  useEffect(() => {
    ML.getAssignment(OPERATOR_HASH)
      .then((res) => {
        setAssignment(res);
        setAssignmentError(null);
      })
      .catch((err: any) => {
        setAssignmentError(err?.message || "Failed to fetch model assignment");
      })
      .finally(() => setAssignmentLoading(false));
  }, []);

  const ensureAssignment = useCallback(async () => {
    if (assignment) return assignment;
    const fresh = await ML.getAssignment(OPERATOR_HASH);
    setAssignment(fresh);
    return fresh;
  }, [assignment]);

  const handleDecision = useCallback(
    async (alert: AlertRecord, chosenAction: string) => {
      setDecisionState((prev) => ({
        ...prev,
        [alert.id]: { status: "saving" },
      }));
      try {
        const currentAssignment = await ensureAssignment();
        const decidedAt = Date.now();
        const latency = Math.max(0, decidedAt - alert.startedAt);

        await ML.recordDecision({
          userIdHash: OPERATOR_HASH,
          action: "fraud_review",
          inputHash: alert.inputHash,
          suggested: {
            model_version: currentAssignment.modelVersion,
            action: alert.suggestedAction,
            alert_id: alert.id,
            generated_at: new Date(alert.startedAt).toISOString(),
          },
          chosen: {
            action: chosenAction,
            decided_at: new Date(decidedAt).toISOString(),
          },
          accepted: chosenAction === alert.suggestedAction,
          latencyMs: latency,
        });

        setDecisionState((prev) => ({
          ...prev,
          [alert.id]: {
            status: "logged",
            message:
              chosenAction === alert.suggestedAction
                ? "Suggestion accepted"
                : "Override recorded",
          },
        }));
      } catch (err: any) {
        setDecisionState((prev) => ({
          ...prev,
          [alert.id]: {
            status: "error",
            message: err?.message || "Failed to record decision",
          },
        }));
      }
    },
    [ensureAssignment]
  );

  const renderAssignmentBanner = () => {
    if (assignmentLoading) {
      return <p className="text-sm text-gray-500">Calculating model assignment…</p>;
    }
    if (assignmentError) {
      return <p className="text-sm text-red-600">{assignmentError}</p>;
    }
    if (!assignment) {
      return <p className="text-sm text-gray-500">No assignment data available.</p>;
    }
    return (
      <div className="space-y-1 text-sm text-gray-700">
        <p>
          Active model <strong>{assignment.activeVersion}</strong>
          {assignment.shadowVersion
            ? ` with shadow ${assignment.shadowVersion} (${Math.round(assignment.canaryPercent * 100)}% cohort)`
            : ""}.
        </p>
        <p className="text-xs text-gray-500">
          {assignment.shadowVersion
            ? assignment.inCanary
              ? "You are in the canary cohort; your decisions help validate the new model."
              : "You are on the baseline model while the canary runs in shadow."
            : "Canary deployment is disabled."}
        </p>
      </div>
    );
  };

  return (
    <div className="main-card">
      <h1 style={{ color: "#00716b", fontWeight: 700, fontSize: 30, marginBottom: 28 }}>Fraud Detection</h1>

      <div className="bg-white p-4 rounded-xl shadow mb-6">
        <h2 className="text-lg font-semibold mb-2">Model assignment</h2>
        {renderAssignmentBanner()}
      </div>

      <div className="space-y-4">
        {alerts.map((alert) => {
          const state = decisionState[alert.id] || { status: "pending" };
          const accepting = state.status === "saving";
          const decided = state.status === "logged";
          return (
            <div key={alert.id} className="bg-white p-4 rounded-xl shadow border border-gray-100">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-gray-500">{alert.date}</p>
                  <p className="text-base font-semibold text-[#e67c00]">{alert.detail}</p>
                  <p className="text-sm text-gray-600">
                    Suggested action: <strong>{alert.suggestedAction.replace(/_/g, " ")}</strong>
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  className="px-4 py-2 rounded bg-[#00716b] text-white text-sm font-medium disabled:opacity-50"
                  disabled={accepting || decided}
                  onClick={() => handleDecision(alert, alert.suggestedAction)}
                >
                  {decided && state.message?.includes("accepted") ? "Accepted" : "Accept suggestion"}
                </button>
                <button
                  className="px-4 py-2 rounded border border-[#00716b] text-[#00716b] text-sm font-medium disabled:opacity-50"
                  disabled={accepting || decided}
                  onClick={() => handleDecision(alert, "manual_investigation")}
                >
                  {decided && state.message?.includes("Override") ? "Override saved" : "Override"}
                </button>
              </div>
              {state.status === "saving" && (
                <p className="mt-2 text-sm text-gray-500">Recording decision…</p>
              )}
              {state.status === "logged" && state.message && (
                <p className="mt-2 text-sm text-emerald-600">{state.message}</p>
              )}
              {state.status === "error" && state.message && (
                <p className="mt-2 text-sm text-red-600">{state.message}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
