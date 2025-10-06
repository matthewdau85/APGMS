import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import nacl from "tweetnacl";

export type LocalKeyStatus = "PENDING" | "ACTIVE" | "GRACE" | "RETIRED";

export interface LocalStoredKey {
  kid: string;
  publicKey: string; // base64url
  secretKey: string; // base64url
  status: LocalKeyStatus;
  createdAt: string;
  graceEndsAt?: string | null;
}

export interface LocalKmsStore {
  activeKid?: string;
  keys: LocalStoredKey[];
  pendingKid?: string;
}

export interface RotationResult {
  previousKid?: string | null;
  activeKid: string;
}

export interface LocalProviderOptions {
  storePath?: string;
}

export interface KmsPublicKeyRecord {
  kid: string;
  publicKey: Uint8Array;
  status: LocalKeyStatus;
  graceEndsAt?: string | null;
}

export class LocalEd25519Provider {
  private storePath: string;
  private store: LocalKmsStore | null = null;

  constructor(options: LocalProviderOptions = {}) {
    const fromEnv = process.env.LOCAL_KMS_STORE_PATH;
    const chosen = options.storePath || fromEnv || path.resolve(process.cwd(), "ops/local-kms.json");
    this.storePath = chosen;
  }

  private async ensureStore(): Promise<LocalKmsStore> {
    if (this.store) {
      return this.store;
    }

    try {
      const raw = await fs.readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw) as LocalKmsStore;
      this.store = this.normalizeStore(parsed);
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
      const keyPair = nacl.sign.keyPair();
      const kid = `local-${randomUUID()}`;
      const createdAt = new Date().toISOString();
      this.store = {
        activeKid: kid,
        keys: [
          {
            kid,
            createdAt,
            status: "ACTIVE",
            publicKey: Buffer.from(keyPair.publicKey).toString("base64url"),
            secretKey: Buffer.from(keyPair.secretKey).toString("base64url"),
          },
        ],
      };
      await this.persist();
    }

    return this.store!;
  }

  private normalizeStore(store: LocalKmsStore): LocalKmsStore {
    const keys = Array.isArray(store.keys) ? store.keys : [];
    const normalized: LocalStoredKey[] = keys.map((key) => ({
      ...key,
      graceEndsAt: key.graceEndsAt ?? null,
    }));
    return { ...store, keys: normalized };
  }

  private async persist(): Promise<void> {
    if (!this.store) return;
    await fs.mkdir(path.dirname(this.storePath), { recursive: true });
    await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
  }

  private getKeyFromStore(store: LocalKmsStore, kid: string): LocalStoredKey | undefined {
    return store.keys.find((k) => k.kid === kid);
  }

  async getActiveKid(): Promise<string> {
    const store = await this.ensureStore();
    if (!store.activeKid) {
      const active = store.keys.find((k) => k.status === "ACTIVE");
      if (!active) throw new Error("LOCAL_KMS_NO_ACTIVE_KID");
      store.activeKid = active.kid;
      await this.persist();
    }
    return store.activeKid!;
  }

  async sign(payload: Uint8Array, kid?: string): Promise<{ kid: string; signature: Uint8Array }> {
    const store = await this.ensureStore();
    const targetKid = kid ?? (await this.getActiveKid());
    const key = this.getKeyFromStore(store, targetKid);
    if (!key) throw new Error(`LOCAL_KMS_KID_UNKNOWN:${targetKid}`);
    if (key.status === "RETIRED") throw new Error(`LOCAL_KMS_KID_RETIRED:${targetKid}`);

    const secret = Buffer.from(key.secretKey, "base64url");
    const sig = nacl.sign.detached(payload, new Uint8Array(secret));
    return { kid: targetKid, signature: new Uint8Array(sig) };
  }

  async getPublicKeys(): Promise<KmsPublicKeyRecord[]> {
    const store = await this.ensureStore();
    const now = Date.now();
    let mutated = false;

    const keys = store.keys.map((key) => {
      if (key.status === "GRACE" && key.graceEndsAt) {
        const graceMs = Date.parse(key.graceEndsAt);
        if (Number.isFinite(graceMs) && graceMs < now) {
          key.status = "RETIRED";
          mutated = true;
        }
      }
      return key;
    });

    if (mutated) {
      await this.persist();
    }

    return keys
      .filter((key) => key.status === "ACTIVE" || key.status === "GRACE")
      .map((key) => ({
        kid: key.kid,
        status: key.status,
        graceEndsAt: key.graceEndsAt ?? null,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
      }));
  }

  async listKeys(): Promise<KmsPublicKeyRecord[]> {
    const store = await this.ensureStore();
    return store.keys.map((key) => ({
      kid: key.kid,
      status: key.status,
      graceEndsAt: key.graceEndsAt ?? null,
      publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
    }));
  }

  async addKey(): Promise<LocalStoredKey> {
    const store = await this.ensureStore();
    const keyPair = nacl.sign.keyPair();
    const kid = `local-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const record: LocalStoredKey = {
      kid,
      createdAt,
      status: "PENDING",
      graceEndsAt: null,
      publicKey: Buffer.from(keyPair.publicKey).toString("base64url"),
      secretKey: Buffer.from(keyPair.secretKey).toString("base64url"),
    };
    store.keys.push(record);
    store.pendingKid = kid;
    await this.persist();
    return record;
  }

  async activateKey(kid: string, graceEndsAt: Date | null): Promise<RotationResult> {
    const store = await this.ensureStore();
    const target = this.getKeyFromStore(store, kid);
    if (!target) throw new Error(`LOCAL_KMS_KID_UNKNOWN:${kid}`);
    if (target.status === "RETIRED") throw new Error(`LOCAL_KMS_KID_RETIRED:${kid}`);

    const previousKid = store.activeKid;
    store.activeKid = kid;
    target.status = "ACTIVE";
    target.graceEndsAt = null;

    if (previousKid && previousKid !== kid) {
      const prev = this.getKeyFromStore(store, previousKid);
      if (prev) {
        prev.status = "GRACE";
        prev.graceEndsAt = graceEndsAt ? graceEndsAt.toISOString() : null;
      }
    }

    store.pendingKid = undefined;
    await this.persist();

    return { previousKid, activeKid: kid };
  }

  async retireKey(kid: string): Promise<void> {
    const store = await this.ensureStore();
    const target = this.getKeyFromStore(store, kid);
    if (!target) return;
    target.status = "RETIRED";
    target.graceEndsAt = null;
    if (store.activeKid === kid) {
      store.activeKid = undefined;
    }
    await this.persist();
  }
}
