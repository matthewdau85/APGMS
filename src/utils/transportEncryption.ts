const textEncoder = new TextEncoder();

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function encryptTransportPayload(keyBase64: string, payload: unknown) {
  const keyData = base64ToUint8(keyBase64);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoded);
  const cipherBytes = new Uint8Array(cipherBuffer);
  const tag = cipherBytes.slice(cipherBytes.length - 16);
  const ciphertext = cipherBytes.slice(0, cipherBytes.length - 16);
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
    tag: arrayBufferToBase64(tag)
  };
}

export async function computeTotp(secretHex: string, time: number = Date.now()): Promise<string> {
  const stepSeconds = 30;
  const digits = 6;
  const counter = Math.floor(time / 1000 / stepSeconds);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter));
  const secretBytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < secretBytes.length; i++) {
    secretBytes[i] = parseInt(secretHex.substr(i * 2, 2), 16);
  }
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, buffer);
  const sigBytes = new Uint8Array(sigBuffer);
  const offset = sigBytes[sigBytes.length - 1] & 0xf;
  const code =
    ((sigBytes[offset] & 0x7f) << 24) |
    ((sigBytes[offset + 1] & 0xff) << 16) |
    ((sigBytes[offset + 2] & 0xff) << 8) |
    (sigBytes[offset + 3] & 0xff);
  const otp = (code % 10 ** digits).toString();
  return otp.padStart(digits, "0");
}
