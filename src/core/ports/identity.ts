export interface IdentityProfile {
  id: string;
  name: string;
  email: string;
  scopes: string[];
}

export interface IdentityProvider {
  verifyToken(token: string): Promise<IdentityProfile>;
}

export class IdentityProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityProviderError";
  }
}
