import { IdentityProvider, IdentityProfile, IdentityProviderError } from "@core/ports";

const USERS: Record<string, IdentityProfile> = {
  "token:admin": { id: "admin", name: "Dev Admin", email: "admin@example.com", scopes: ["read", "write", "admin"] },
  "token:user": { id: "user", name: "Dev User", email: "user@example.com", scopes: ["read"] },
};

export function createDevIdentityProvider(): IdentityProvider {
  return {
    async verifyToken(token: string): Promise<IdentityProfile> {
      const profile = USERS[token];
      if (!profile) {
        throw new IdentityProviderError("UNAUTHENTICATED");
      }
      return profile;
    },
  };
}
