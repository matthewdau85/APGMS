function normalizeClaims(claims) {
  return claims && typeof claims === 'object' ? { ...claims } : {};
}

export class MockIdentity {
  constructor() {
    this.allowedUsers = (process.env.MOCK_IDENTITY_USERS || 'operator').split(',');
  }

  async authenticate(credentials) {
    const username = credentials?.username || credentials?.token || 'operator';
    if (!this.allowedUsers.includes(username)) {
      return null;
    }
    return {
      id: String(username),
      claims: {
        roles: ['mock'],
      },
    };
  }

  async authorize(identity, resource, action) {
    if (!identity) return false;
    if (identity.claims?.roles?.includes('mock-admin')) {
      return true;
    }
    const scope = `${resource}:${action}`;
    const allowed = process.env.MOCK_IDENTITY_ALLOW || 'all';
    if (allowed === 'all') return true;
    return allowed.split(',').includes(scope);
  }
}
