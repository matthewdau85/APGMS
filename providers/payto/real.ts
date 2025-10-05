import type { PayToPort, PayToOperationResult, PayToDebitResult } from "@core/ports/types/payto";

interface HttpResponse<T> {
  ok: boolean;
  status: number;
  json?: T;
  code?: string;
}

async function postJson<T>(baseUrl: string, path: string, body: unknown): Promise<HttpResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let parsed: any;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!res.ok) {
    const code = parsed?.code || `HTTP_${res.status}`;
    return { ok: false, status: res.status, code, json: parsed };
  }

  return { ok: true, status: res.status, json: parsed };
}

export function createRealPayTo(): PayToPort {
  const baseUrl = process.env.BANK_API_BASE || "http://127.0.0.1:3100";

  return {
    async createMandate({ abn, periodId, capCents }) {
      const res = await postJson<PayToOperationResult>(baseUrl, "/payto/mandates", { abn, periodId, capCents });
      if (!res.ok) {
        return { ok: false, code: res.code } satisfies PayToOperationResult;
      }
      return res.json ?? { ok: true };
    },
    async verifyMandate(mandateId) {
      const res = await postJson<PayToOperationResult>(baseUrl, `/payto/mandates/${mandateId}/verify`, {});
      if (!res.ok) return { ok: false, code: res.code } satisfies PayToOperationResult;
      return res.json ?? { ok: true };
    },
    async debitMandate(mandateId, amountCents, metadata) {
      const res = await postJson<PayToDebitResult>(baseUrl, `/payto/mandates/${mandateId}/debit`, { amountCents, metadata });
      if (!res.ok) return { ok: false, code: res.code } satisfies PayToDebitResult;
      return res.json ?? { ok: true };
    },
    async cancelMandate(mandateId) {
      const res = await postJson<PayToOperationResult>(baseUrl, `/payto/mandates/${mandateId}/cancel`, {});
      if (!res.ok) return { ok: false, code: res.code } satisfies PayToOperationResult;
      return res.json ?? { ok: true };
    },
  } satisfies PayToPort;
}
