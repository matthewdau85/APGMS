function requireFlag() {
  const flag = process.env.ANOMALY_REAL_ENABLED;
  if (!flag || !['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    throw new Error('Real anomaly provider disabled. Set ANOMALY_REAL_ENABLED=true to enable.');
  }
}

async function postJson(path, payload) {
  const base = process.env.ANOMALY_API_BASE;
  if (!base) throw new Error('Set ANOMALY_API_BASE to enable real anomaly provider');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Anomaly API error ${res.status}`);
  }
  return res.json();
}

export class RealAnomaly {
  async score(payload) {
    requireFlag();
    return postJson('/score', payload);
  }
}
