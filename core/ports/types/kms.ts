export interface VerificationResult {
  ok: boolean;
  code?: string;
  details?: string;
}

export interface KmsPort {
  verify(payload: Uint8Array, signature: Uint8Array, options?: { keyId?: string }): Promise<VerificationResult>;
}
