const DEFAULT_BASE = "http://localhost:3000/sim/rail";

type SimParams = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  rail: "EFT" | "BPAY";
  reference?: string;
  idempotencyKey: string;
};

type SimResult = {
  provider_receipt_id: string;
  paid_at: string;
};

export async function sendViaSimRail(params: SimParams): Promise<SimResult> {
  const base = (process.env.SIM_RAIL_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}/${params.rail.toLowerCase()}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      amount_cents: params.amount_cents,
      abn: params.abn,
      taxType: params.taxType,
      periodId: params.periodId,
      reference: params.reference,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sim rail error: ${text || res.status}`);
  }
  const data = await res.json();
  const provider_ref = String(data.provider_ref || "");
  const paid_at = String(data.paid_at || new Date().toISOString());
  if (!provider_ref) throw new Error("Sim rail missing provider_ref");
  return { provider_receipt_id: provider_ref, paid_at };
}
