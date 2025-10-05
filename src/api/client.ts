export async function getBalance(abn: string) {
  const r = await fetch(`/api/balance/${abn}`);
  if (!r.ok) throw new Error("balance failed");
  return r.json();
}

export async function closeAndIssue(abn: string, periodId: number) {
  const r = await fetch(`/api/reconcile/close-and-issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ abn, period_id: periodId }),
  });
  if (!r.ok) throw new Error("reconcile failed");
  return r.json();
}
