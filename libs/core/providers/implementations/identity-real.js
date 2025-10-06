function requireFlag() {
  const flag = process.env.IDENTITY_REAL_ENABLED;
  if (!flag || !['1', 'true', 'yes'].includes(flag.toLowerCase())) {
    throw new Error('Real identity provider disabled. Set IDENTITY_REAL_ENABLED=true to enable.');
  }
}

async function postJson(path, payload) {
  const base = process.env.IDENTITY_API_BASE;
  if (!base) throw new Error('Set IDENTITY_API_BASE to enable real identity provider');
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Identity API error ${res.status}`);
  }
  return res.json();
}

export class RealIdentity {
  async authenticate(credentials) {
    requireFlag();
    return postJson('/authenticate', credentials);
  }

  async authorize(identity, resource, action) {
    requireFlag();
    const result = await postJson('/authorize', { identity, resource, action });
    return Boolean(result?.allowed);
  }
}
