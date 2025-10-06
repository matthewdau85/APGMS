const BASE_URL = process.env.NEXT_PUBLIC_TAX_ENGINE_URL ?? "http://localhost:8000";

type JsonRecord = Record<string, unknown>;

async function postJson<TResponse>(path: string, payload: JsonRecord): Promise<TResponse> {
  const target = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tax engine request failed (${response.status}): ${text}`);
  }
  return response.json() as Promise<TResponse>;
}

export { postJson };
