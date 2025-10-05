import { AdapterMode, AdapterModes, AdapterName } from "../src/simulator/types";

const BASE =
  process.env.NEXT_PUBLIC_PAYMENTS_BASE_URL ||
  process.env.PAYMENTS_BASE_URL ||
  "http://localhost:3001";

async function handle(res: Response) {
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* noop */
  }
  if (!res.ok) {
    throw new Error(json?.error || json?.detail || text || `HTTP ${res.status}`);
  }
  return json;
}

export const SimulatorClient = {
  async fetchModes(): Promise<AdapterModes> {
    const res = await fetch(`${BASE}/simulator/modes`);
    const json = await handle(res);
    return json?.modes as AdapterModes;
  },
  async updateMode(adapter: AdapterName, mode: AdapterMode): Promise<AdapterModes> {
    const res = await fetch(`${BASE}/simulator/modes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adapter, mode }),
    });
    const json = await handle(res);
    return json?.modes as AdapterModes;
  },
};
