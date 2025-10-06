import { createHmac } from "node:crypto";

const HEADER = "x-sim-hmac";

export function getSimSecret() {
  return process.env.SIM_SECRET || "sim-secret";
}

export function computeSignature(body: string) {
  return createHmac("sha256", getSimSecret()).update(body).digest("hex");
}

export function verifySignature(body: string, headerValue?: string | string[]) {
  if (!headerValue) return false;
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const expected = computeSignature(body);
  return timingSafeEqual(provided, expected);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export { HEADER as SIM_HEADER };
