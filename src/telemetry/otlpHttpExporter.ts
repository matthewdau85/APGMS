import { SpanData, SpanExporter } from "./api";

type ExporterOptions = {
  url: string;
};

export class OTLPTraceExporter implements SpanExporter {
  constructor(private readonly options: ExporterOptions) {}

  async export(span: SpanData) {
    try {
      const body = {
        resource: span.resourceAttributes ?? {},
        spans: [
          {
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            startTimeUnixMillis: span.startTime,
            endTimeUnixMillis: span.endTime,
            attributes: span.attributes,
          },
        ],
      };
      await fetch(this.options.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error("OTLP export failed", error);
    }
  }

  async shutdown() {
    return;
  }
}
