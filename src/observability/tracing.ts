let sdk: any;

function isEnabled(value: string | undefined) {
  return value !== undefined && ["1", "true", "TRUE"].includes(value);
}

export async function initTracing() {
  const enabled = process.env.OTEL_ENABLED;
  if (!isEnabled(enabled)) {
    return;
  }

  const url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!url) {
    console.warn("OTEL_ENABLED set but OTEL_EXPORTER_OTLP_ENDPOINT missing");
    return;
  }

  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, api] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/api"),
    ]);

    const { diag, DiagConsoleLogger, DiagLogLevel } = api as any;
    if (!process.env.OTEL_LOG_LEVEL || process.env.OTEL_LOG_LEVEL === "debug") {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({ url }),
    });

    await sdk.start();
    console.log("OpenTelemetry tracing initialized");

    const shutdown = async () => {
      if (!sdk) return;
      try {
        await sdk.shutdown();
        console.log("OpenTelemetry tracing terminated");
      } catch (err) {
        console.error("Error terminating OpenTelemetry", err);
      }
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("Failed to initialize OpenTelemetry", err);
  }
}
