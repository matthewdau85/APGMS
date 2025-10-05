import { signRpt as localSign, RptPayload } from "./ed25519";

interface RptSigner {
  sign(payload: RptPayload): Promise<string>;
}

class LocalEd25519Signer implements RptSigner {
  private readonly secretKey: Uint8Array;

  constructor(secretKeyB64: string) {
    const key = Buffer.from(secretKeyB64, "base64");
    if (key.length !== 64) {
      throw new Error("RPT_ED25519_SECRET_BASE64_INVALID");
    }
    this.secretKey = new Uint8Array(key);
  }

  async sign(payload: RptPayload): Promise<string> {
    return localSign(payload, this.secretKey);
  }
}

class KmsRptSigner implements RptSigner {
  async sign(_payload: RptPayload): Promise<string> {
    console.warn("FEATURE_KMS enabled but no KMS adapter is configured");
    throw new Error("KMS_SIGNER_NOT_IMPLEMENTED");
  }
}

let cachedSigner: RptSigner | null = null;

function getSigner(): RptSigner {
  if (cachedSigner) {
    return cachedSigner;
  }

  if (process.env.FEATURE_KMS === "true") {
    cachedSigner = new KmsRptSigner();
    return cachedSigner;
  }

  const secret = process.env.RPT_ED25519_SECRET_BASE64;
  if (!secret) {
    throw new Error("RPT_ED25519_SECRET_BASE64_MISSING");
  }
  cachedSigner = new LocalEd25519Signer(secret);
  return cachedSigner;
}

export async function signRpt(payload: RptPayload): Promise<string> {
  const signer = getSigner();
  return signer.sign(payload);
}
