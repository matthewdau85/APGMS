export type KmsVerifyParams = {
  payload: Uint8Array | Buffer;
  signature: Uint8Array | Buffer;
  keyId?: string;
};

export type KmsSignParams = {
  payload: Uint8Array | Buffer;
  keyId?: string;
};

export interface KmsPort {
  getCapabilities?(): string[];
  verify(params: KmsVerifyParams): Promise<boolean>;
  sign?(params: KmsSignParams): Promise<Uint8Array>;
}
