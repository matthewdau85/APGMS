export interface KmsVerifier {
  /**
   * Verify an Ed25519 signature over `payload`.
   * @param payload raw bytes of the canonical JSON (c14n)
   * @param signature signature bytes (NOT base64)
   * @param kid optional key id (ignored by local provider)
   */
  verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean>;
}

export interface KmsProvider {
  getPublicKey(kid: string): Promise<Uint8Array>;
  sign(kid: string, message: Uint8Array): Promise<Uint8Array>;
  verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}
