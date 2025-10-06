export async function getBalance(abn: string) {
  const r = await fetch(`/api/balance/${abn}`);
  if (!r.ok) throw new Error("balance failed");
  return r.json();
}
