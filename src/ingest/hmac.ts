import crypto from "crypto";

function extractDigest(signatureHeader: string): { algorithm: string; digest: Buffer } | null {
  const trimmed = signatureHeader.trim();
  const parts = trimmed.split("=");
  if (parts.length === 2) {
    const [algorithm, digest] = parts;
    if (algorithm.toLowerCase() !== "sha256") return null;
    if (!/^[0-9a-f]+$/i.test(digest)) return null;
    return { algorithm: "sha256", digest: Buffer.from(digest, "hex") };
  }
  if (!/^[0-9a-f]+$/i.test(trimmed)) return null;
  return { algorithm: "sha256", digest: Buffer.from(trimmed, "hex") };
}

export function verifyHmac(signatureHeader: string | undefined, rawBody: string, secretBase64: string | undefined): boolean {
  if (!signatureHeader || !secretBase64) {
    return false;
  }
  const extracted = extractDigest(signatureHeader);
  if (!extracted) {
    return false;
  }

  const secret = Buffer.from(secretBase64, "base64");
  if (secret.length === 0) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const provided = extracted.digest;

  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}
