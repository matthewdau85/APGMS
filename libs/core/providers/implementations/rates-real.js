function requireFlag() {
  const flag = process.env.RATES_REAL_ENABLED;
  if (!flag || !['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    throw new Error('Real rates provider disabled. Set RATES_REAL_ENABLED=true to enable.');
  }
}

async function fetchJson(path) {
  const base = process.env.RATES_API_BASE;
  if (!base) {
    throw new Error('Set RATES_API_BASE to use real rates provider');
  }
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    throw new Error(`Rates API request failed: ${res.status}`);
  }
  return res.json();
}

export class RealRates {
  async currentFor(date) {
    requireFlag();
    const q = new URLSearchParams({ date: new Date(date || Date.now()).toISOString() });
    return fetchJson(`/rates/current?${q}`);
  }

  async listVersions() {
    requireFlag();
    return fetchJson('/rates/versions');
  }
}
