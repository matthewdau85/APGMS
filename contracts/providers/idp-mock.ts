import crypto from "node:crypto";
import type { IdpPort } from "../interfaces";
import { makeError, makeIdempotencyKey, isoNow } from "./shared";

function makeToken(seed: string): string {
  return Buffer.from(seed).toString("base64url");
}

export async function createProvider(): Promise<IdpPort> {
  const refreshes = new Map<string, string>();
  return {
    timeoutMs: 2500,
    retriableCodes: ["IDP_THROTTLED"],
    async authenticate(credentials) {
      if (credentials.password !== "correct-horse-battery-staple") {
        throw makeError("IDP_UNAUTHORIZED", "Invalid credentials", false, 401);
      }
      const tokenSeed = `${credentials.username}:${isoNow()}`;
      const token = makeToken(tokenSeed);
      refreshes.set(token, tokenSeed);
      return {
        token,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    },
    async refresh(token: string) {
      const seed = refreshes.get(token) ?? `${token}:refresh`;
      const next = makeToken(seed + ":next");
      refreshes.set(next, seed + ":next");
      return {
        token: next,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      };
    },
    async simulateError(kind) {
      switch (kind) {
        case "timeout":
          return makeError("IDP_TIMEOUT", "Identity provider timeout", true, 504);
        case "unauthorized":
        default:
          return makeError("IDP_UNAUTHORIZED", "Invalid credentials", false, 401);
      }
    },
    idempotencyKey(credentials) {
      return makeIdempotencyKey([credentials.username, crypto.createHash("sha1").update(credentials.password).digest("hex")]);
    },
  };
}

export default createProvider;
