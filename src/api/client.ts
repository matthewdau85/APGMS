export async function getBalance(abn: string) {
  const r = await fetch(`/api/balance/${abn}`);
  if (!r.ok) throw new Error("balance failed");
  return r.json();
}
export async function getLatestEvidence(abn: string, periodId: number | string) {
  const r = await fetch(`/api/evidence/${abn}/${periodId}`);
  if (!r.ok) throw new Error("evidence failed");
  return r.json();
}
