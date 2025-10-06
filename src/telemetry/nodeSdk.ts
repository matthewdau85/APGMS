import { setGlobalTracerProvider, SpanData, SpanExporter, SpanProcessor, Tracer, TracerProvider } from "./api";
import { Resource } from "./resource";

class SimpleSpanProcessor implements SpanProcessor {
  constructor(private readonly exporter: SpanExporter, private readonly resource: Resource) {}

  async onEnd(span: SpanData) {
    await this.exporter.export({ ...span, resourceAttributes: this.resource.attributes });
  }

  async shutdown() {
    if (this.exporter.shutdown) {
      await this.exporter.shutdown();
    }
  }
}

class BasicTracerProvider implements TracerProvider {
  private readonly tracer: Tracer;
  constructor(private readonly processor: SimpleSpanProcessor) {
    this.tracer = new Tracer(this.processor);
  }

  getTracer(_name: string) {
    return this.tracer;
  }

  async shutdown() {
    await this.processor.shutdown();
  }
}

export interface NodeSDKOptions {
  resource: Resource;
  traceExporter: SpanExporter;
}

export class NodeSDK {
  private provider: BasicTracerProvider | null = null;

  constructor(private readonly options: NodeSDKOptions) {}

  async start() {
    this.provider = new BasicTracerProvider(new SimpleSpanProcessor(this.options.traceExporter, this.options.resource));
    setGlobalTracerProvider(this.provider);
  }

  async shutdown() {
    if (this.provider) {
      await this.provider.shutdown();
      this.provider = null;
    }
  }
}
