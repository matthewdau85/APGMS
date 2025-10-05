import { IdentityProvider, IdentityProfile, IdentityProviderError } from "@core/ports";

export function createMockIdentityProvider(): IdentityProvider {
  return {
    async verifyToken(token: string): Promise<IdentityProfile> {
      if (!token) {
        throw new IdentityProviderError("TOKEN_REQUIRED");
      }
      return { id: token, name: "Mock User", email: "mock@example.com", scopes: ["read"] };
    },
  };
}
