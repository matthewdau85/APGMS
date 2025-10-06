import React, { useEffect, useState, useCallback } from "react";

type Approval = {
  id: number;
  created_at: string;
  status: string;
  abn: string;
  tax_type: string;
  period_id: string;
  amount_cents: number;
  requester: string;
  memo?: string | null;
};

type Decision = "approve" | "decline";

function centsToDollars(cents: number) {
  return (cents / 100).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
}

export default function Approvals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/ops/approvals/pending");
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const list: Approval[] = Array.isArray(data.approvals) ? data.approvals : [];
      setApprovals(list);
      const nextComments: Record<number, string> = {};
      list.forEach((item) => {
        nextComments[item.id] = "";
      });
      setComments(nextComments);
    } catch (err: any) {
      setError(err?.message || "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCommentChange = (id: number, value: string) => {
    setComments((prev) => ({ ...prev, [id]: value }));
  };

  const act = async (id: number, action: Decision) => {
    const comment = (comments[id] || "").trim();
    if (!comment) {
      setError("Please provide a comment before taking action.");
      return;
    }
    setError(null);
    setSuccessMessage(null);
    setSubmittingId(id);
    try {
      const res = await fetch(`/ops/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Unable to ${action}`);
      }
      setSuccessMessage(`Approval #${id} ${action === "approve" ? "approved" : "declined"}.`);
      await load();
    } catch (err: any) {
      setSuccessMessage(null);
      setError(err?.message || `Unable to ${action}`);
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="main-card space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pending Approvals</h1>
        <button
          className="button"
          onClick={() => {
            setSuccessMessage(null);
            load();
          }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      {loading && <p>Loading approvals…</p>}
      {error && !loading && <p className="text-red-600">{error}</p>}
      {successMessage && <p className="text-green-600">{successMessage}</p>}
      {!loading && approvals.length === 0 && <p>No approvals waiting for action.</p>}
      {!loading && approvals.length > 0 && (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <div key={approval.id} className="bg-white shadow rounded-lg p-4 border border-gray-200">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{approval.tax_type} • {approval.period_id}</h2>
                  <p className="text-gray-600">ABN {approval.abn}</p>
                  <p className="text-gray-600">Requested by {approval.requester}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{centsToDollars(approval.amount_cents)}</p>
                  <p className="text-sm text-gray-500">Raised {new Date(approval.created_at).toLocaleString()}</p>
                </div>
              </div>
              {approval.memo && <p className="mt-3 text-sm text-gray-700">{approval.memo}</p>}
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`comment-${approval.id}`}>
                  Comment (required)
                </label>
                <textarea
                  id={`comment-${approval.id}`}
                  className="w-full border rounded-md p-2"
                  rows={3}
                  value={comments[approval.id] || ""}
                  onChange={(e) => onCommentChange(approval.id, e.target.value)}
                />
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="button"
                  onClick={() => act(approval.id, "approve")}
                  disabled={submittingId === approval.id}
                >
                  Approve
                </button>
                <button
                  className="button"
                  style={{ backgroundColor: "#b91c1c" }}
                  onClick={() => act(approval.id, "decline")}
                  disabled={submittingId === approval.id}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
