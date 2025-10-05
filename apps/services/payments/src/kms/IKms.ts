export interface IKms {
  /**
   * Verify the detached signature produced by the RPT issuer.
   * @param payload raw bytes of the canonical JSON (c14n)
   * @param signature signature bytes (NOT base64)
   * @param kid optional key id associated with the signature (used for rotation)
   */
  verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean>;
}
