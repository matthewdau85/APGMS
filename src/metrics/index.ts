export type MetricType = "gauge" | "counter";

type MetricEntry = {
  name: string;
  help: string;
  type: MetricType;
  value: number;
};

const metrics = new Map<string, MetricEntry>();

function ensureMetric(name: string, type: MetricType, help: string) {
  const existing = metrics.get(name);
  if (existing) {
    if (existing.type !== type) {
      throw new Error(`Metric ${name} already registered with type ${existing.type}`);
    }
    return existing;
  }
  const entry: MetricEntry = { name, help, type, value: 0 };
  metrics.set(name, entry);
  return entry;
}

export function setGauge(name: string, value: number, help: string) {
  const entry = ensureMetric(name, "gauge", help);
  entry.value = value;
}

export function incCounter(name: string, delta: number, help: string) {
  const entry = ensureMetric(name, "counter", help);
  entry.value += delta;
}

export function resetCounter(name: string, help: string) {
  const entry = ensureMetric(name, "counter", help);
  entry.value = 0;
}

export function renderMetrics() {
  let out = "";
  for (const entry of metrics.values()) {
    out += `# HELP ${entry.name} ${entry.help}\n`;
    out += `# TYPE ${entry.name} ${entry.type}\n`;
    out += `${entry.name} ${Number.isFinite(entry.value) ? entry.value : 0}\n`;
  }
  return out;
}

export function getMetricValue(name: string) {
  return metrics.get(name)?.value ?? 0;
}
