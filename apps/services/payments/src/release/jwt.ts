import { createHmac } from "node:crypto";

export type JwtClaims = Record<string, any>;

export function verifyJwt(token: string, secret: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("INVALID_JWT_FORMAT");
  }
  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  if (expected !== signature) {
    throw new Error("INVALID_JWT_SIGNATURE");
  }
  const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  const payload = JSON.parse(payloadJson);
  return payload;
}
