import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | undefined;

export function initTelemetry(serviceName: string) {
  if (process.env.OTEL_SDK_DISABLED === "true") {
    return;
  }
  if (sdk) {
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_NAMESPACE]: "apgms",
    })
  );

  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || undefined,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk
    .start()
    .catch((err) => {
      console.error("failed to initialise telemetry", err);
    });

  const shutdown = async () => {
    try {
      await sdk?.shutdown();
    } catch (err) {
      console.error("failed to shutdown telemetry", err);
    }
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
