import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

export type ContextStore = Map<string, unknown>;

const storage = new AsyncLocalStorage<ContextStore>();
const rootContext: ContextStore = new Map();

export interface SpanAttributes {
  [key: string]: unknown;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: SpanAttributes;
  resourceAttributes?: Record<string, unknown>;
}

export interface SpanExporter {
  export(span: SpanData): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface SpanProcessor {
  onEnd(span: SpanData): Promise<void>;
  shutdown(): Promise<void>;
}

export interface TracerProvider {
  getTracer(name: string): Tracer;
  shutdown(): Promise<void>;
}

export class Span {
  private attributes: SpanAttributes = {};
  private endTimestamp?: number;

  constructor(
    public readonly name: string,
    private readonly traceId: string,
    private readonly spanId: string,
    private readonly parentSpanId: string | undefined,
    private readonly processor: SpanProcessor,
    private readonly startTimestamp: number = Date.now()
  ) {}

  setAttributes(attrs: SpanAttributes) {
    this.attributes = { ...this.attributes, ...attrs };
  }

  setAttribute(key: string, value: unknown) {
    this.attributes[key] = value;
  }

  async end() {
    if (this.endTimestamp) return;
    this.endTimestamp = Date.now();
    const spanData: SpanData = {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      startTime: this.startTimestamp,
      endTime: this.endTimestamp,
      attributes: this.attributes,
    };
    await this.processor.onEnd(spanData);
  }

  context() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
    };
  }
}

export class Tracer {
  constructor(private readonly processor: SpanProcessor) {}

  startSpan(name: string, _options?: unknown, parentContext?: ContextStore) {
    const parentSpan = (parentContext?.get("active-span") as Span | undefined) ?? undefined;
    const traceId = parentSpan ? parentSpan.context().traceId : randomHex(16);
    const spanId = randomHex(8);
    const span = new Span(name, traceId, spanId, parentSpan?.context().spanId, this.processor);
    return span;
  }
}

class NoopProcessor implements SpanProcessor {
  async onEnd(_span: SpanData) {
    return;
  }
  async shutdown() {
    return;
  }
}

class NoopProvider implements TracerProvider {
  private readonly tracer = new Tracer(new NoopProcessor());
  async shutdown() {
    return;
  }
  getTracer(_name: string) {
    return this.tracer;
  }
}

let globalProvider: TracerProvider = new NoopProvider();

export function setGlobalTracerProvider(provider: TracerProvider) {
  globalProvider = provider;
}

export const trace = {
  getTracer(name: string) {
    return globalProvider.getTracer(name);
  },
};

export const context = {
  active(): ContextStore {
    return storage.getStore() ?? rootContext;
  },
  with(ctx: ContextStore, fn: () => void) {
    storage.run(ctx, fn);
  },
};

export type Carrier = Record<string, string>;

type Setter = (carrier: Carrier, key: string, value: string) => void;

export const propagation = {
  extract(parent: ContextStore, carrier: Carrier): ContextStore {
    const ctx = new Map(parent ?? rootContext);
    const requestId = carrier["x-request-id"] || carrier["X-Request-Id"];
    if (requestId) {
      ctx.set("x-request-id", requestId);
    }
    return ctx;
  },
  inject(ctx: ContextStore, carrier: Carrier, setter: Setter = defaultSetter) {
    const requestId = ctx.get("x-request-id");
    if (typeof requestId === "string") {
      setter(carrier, "x-request-id", requestId);
    }
    return carrier;
  },
};

function defaultSetter(carrier: Carrier, key: string, value: string) {
  carrier[key] = value;
}

export function randomHex(bytes: number) {
  return randomBytes(bytes).toString("hex");
}
