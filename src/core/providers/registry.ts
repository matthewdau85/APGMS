import { randomUUID } from "crypto";
import type {
  AnomalyPort,
  BankPort,
  FeatureFlags,
  KmsPort,
  PayCommand,
  PaymentRecord,
  ProviderBindings,
  ProviderSelection,
  RatesPort,
  RefundCommand,
  RefundReceipt,
  StatementsPort,
} from "@core/ports";

const PROVIDER_KEYS: Array<keyof ProviderBindings> = ["bank", "kms", "rates", "statements", "anomaly"];

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

export function getFeatureFlags(): FeatureFlags {
  return {
    protoKillSwitch: parseBoolean(process.env.PROTO_KILL_SWITCH),
    shadowMode: parseBoolean(process.env.SHADOW_MODE),
  };
}

abstract class BaseBankProvider implements BankPort {
  private readonly store = new Map<string, PaymentRecord>();

  protected constructor(public readonly providerName: string) {}

  async pay(command: PayCommand): Promise<PaymentRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: PaymentRecord = {
      id,
      amount: command.amount ?? 0,
      currency: command.currency ?? "AUD",
      reference: command.reference,
      metadata: command.metadata,
      status: "pending",
      provider: this.providerName,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(id, record);
    return { ...record };
  }

  async getPayment(id: string): Promise<PaymentRecord | undefined> {
    const record = this.store.get(id);
    return record ? { ...record } : undefined;
  }

  async refund(command: RefundCommand): Promise<RefundReceipt> {
    const now = new Date().toISOString();
    const existing = this.store.get(command.paymentId);
    if (existing) {
      existing.status = "refunded";
      existing.updatedAt = now;
      this.store.set(existing.id, existing);
    }
    return {
      id: randomUUID(),
      paymentId: command.paymentId,
      provider: this.providerName,
      status: "accepted",
      processedAt: now,
      metadata: command.metadata,
    };
  }
}

class MockBankProvider extends BaseBankProvider {
  constructor() {
    super("bank:mock");
  }
}

class LiveBankProvider extends BaseBankProvider {
  constructor() {
    super("bank:live");
  }
}

class BaseKmsProvider implements KmsPort {
  constructor(public readonly providerName: string, private readonly keyId: string) {}

  getKeyId(): string {
    return this.keyId;
  }

  async sign(payload: string): Promise<string> {
    const material = `${this.keyId}:${this.providerName}:${payload}`;
    return Buffer.from(material).toString("base64url");
  }

  async verify(payload: string, signature: string): Promise<boolean> {
    return signature === (await this.sign(payload));
  }
}

class MockKmsProvider extends BaseKmsProvider {
  constructor() {
    super("kms:mock", "mock-key");
  }
}

class LiveKmsProvider extends BaseKmsProvider {
  constructor() {
    super("kms:live", "live-key");
  }
}

class BaseRatesProvider implements RatesPort {
  constructor(public readonly providerName: string, private readonly rates: Record<string, number>) {}

  async getRate(code: string): Promise<number> {
    const upper = code.toUpperCase();
    const rate = this.rates[upper];
    if (typeof rate !== "number") {
      throw new Error(`Rate not found for ${code}`);
    }
    return rate;
  }

  async listRates(): Promise<Record<string, number>> {
    return { ...this.rates };
  }
}

class MockRatesProvider extends BaseRatesProvider {
  constructor() {
    super("rates:mock", { AUD: 1, USD: 0.65, EUR: 0.6 });
  }
}

class LiveRatesProvider extends BaseRatesProvider {
  constructor() {
    super("rates:live", { AUD: 1, USD: 0.64, EUR: 0.59, GBP: 0.51 });
  }
}

class BaseStatementsProvider implements StatementsPort {
  constructor(public readonly providerName: string) {}

  async generateStatement(accountId: string, options: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      provider: this.providerName,
      generatedAt: new Date().toISOString(),
      metadata: { accountId, options },
    };
  }
}

class MockStatementsProvider extends BaseStatementsProvider {
  constructor() {
    super("statements:mock");
  }
}

class LiveStatementsProvider extends BaseStatementsProvider {
  constructor() {
    super("statements:live");
  }
}

class BaseAnomalyProvider implements AnomalyPort {
  constructor(public readonly providerName: string) {}

  async detect(_payload: Record<string, unknown>) {
    return { anomalies: [] as Array<{ message: string; score: number }> };
  }

  mode(): "shadow" | "active" {
    return getFeatureFlags().shadowMode ? "shadow" : "active";
  }
}

class MockAnomalyProvider extends BaseAnomalyProvider {
  constructor() {
    super("anomaly:mock");
  }
}

class LiveAnomalyProvider extends BaseAnomalyProvider {
  constructor() {
    super("anomaly:live");
  }
}

type ProviderFactoryMap = {
  [K in keyof ProviderBindings]: Record<string, () => ProviderBindings[K]>;
};

const FACTORIES: ProviderFactoryMap = {
  bank: {
    mock: () => new MockBankProvider(),
    live: () => new LiveBankProvider(),
  },
  kms: {
    mock: () => new MockKmsProvider(),
    live: () => new LiveKmsProvider(),
  },
  rates: {
    mock: () => new MockRatesProvider(),
    live: () => new LiveRatesProvider(),
  },
  statements: {
    mock: () => new MockStatementsProvider(),
    live: () => new LiveStatementsProvider(),
  },
  anomaly: {
    mock: () => new MockAnomalyProvider(),
    live: () => new LiveAnomalyProvider(),
  },
};

const DEFAULT_SELECTION: ProviderSelection = {
  bank: "mock",
  kms: "mock",
  rates: "mock",
  statements: "mock",
  anomaly: "mock",
};

let cachedSignature: string | null = null;
let cachedBindings: ProviderBindings | null = null;
let cachedSelection: ProviderSelection | null = null;

function parseProviderEnv(): ProviderSelection {
  const selection: ProviderSelection = { ...DEFAULT_SELECTION };
  const raw = process.env.PROVIDERS;
  if (!raw) {
    return selection;
  }

  for (const chunk of raw.split(";")) {
    const [rawKey, rawValue] = chunk.split("=").map((part) => part?.trim());
    if (!rawKey || !rawValue) continue;
    const normalizedKey = rawKey.toLowerCase() as keyof ProviderBindings;
    if (!PROVIDER_KEYS.includes(normalizedKey)) continue;
    selection[normalizedKey] = rawValue.toLowerCase();
  }

  return selection;
}

function instantiateProviders(selection: ProviderSelection): ProviderBindings {
  const bindings = {} as ProviderBindings;
  for (const key of PROVIDER_KEYS) {
    const desired = selection[key];
    const bucket = FACTORIES[key];
    const factory = bucket[desired] ?? bucket[DEFAULT_SELECTION[key]];
    if (!factory) {
      throw new Error(`No factory available for provider ${String(key)}:${desired}`);
    }
    bindings[key] = factory();
  }
  return bindings;
}

function serializeSelection(selection: ProviderSelection): string {
  return PROVIDER_KEYS.map((key) => `${key}:${selection[key]}`).join("|");
}

export function getProviderRegistry(): ProviderBindings {
  const selection = parseProviderEnv();
  const signature = serializeSelection(selection);
  if (!cachedBindings || signature !== cachedSignature) {
    cachedBindings = instantiateProviders(selection);
    cachedSelection = selection;
    cachedSignature = signature;
  }
  return cachedBindings;
}

export function describeProviderRegistry() {
  const bindings = getProviderRegistry();
  const selection = cachedSelection ?? DEFAULT_SELECTION;
  const available = Object.fromEntries(
    PROVIDER_KEYS.map((key) => [key, Object.keys(FACTORIES[key])])
  ) as Record<keyof ProviderBindings, string[]>;

  return {
    bindings: { ...selection },
    active: Object.fromEntries(
      PROVIDER_KEYS.map((key) => [key, bindings[key].providerName])
    ) as Record<keyof ProviderBindings, string>,
    available,
    flags: getFeatureFlags(),
  };
}

export function resetProviderRegistryCache() {
  cachedBindings = null;
  cachedSelection = null;
  cachedSignature = null;
}
