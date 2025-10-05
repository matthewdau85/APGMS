// apps/services/payments/src/kms/kmsProvider.ts
import { IKms } from './IKms';
import { LocalKeyProvider } from './localKey';
import { RemoteKmsProvider } from './remoteKms';

export interface KmsProvider {
  getKeyId(): string;
  signEd25519(data: Uint8Array, keyIdOverride?: string): Promise<Uint8Array>;
  verifyEd25519(data: Uint8Array, sig: Uint8Array, pubKey: Uint8Array): Promise<boolean>;
}

type Backend = 'local' | 'remote' | 'aws' | 'gcp' | 'hsm';

/**
 * Select the appropriate verification backend.
 */
export function selectKms(): IKms {
  const backend = (process.env.KMS_BACKEND ?? 'remote').toLowerCase() as Backend;
  switch (backend) {
    case 'local':
      return new LocalKeyProvider();
    case 'remote':
    default:
      return new RemoteKmsProvider();
  }
}
