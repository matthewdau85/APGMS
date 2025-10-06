interface CounterOptions {
  name: string;
  help: string;
  labelNames: string[];
}

interface HistogramOptions {
  name: string;
  help: string;
  labelNames: string[];
  buckets: number[];
}

type LabelValues = Record<string, string>;

type CounterSnapshot = {
  labels: LabelValues;
  value: number;
};

type HistogramSnapshot = {
  labels: LabelValues;
  buckets: Array<{ le: number | string; value: number }>;
  sum: number;
  count: number;
};

class Counter {
  private readonly values = new Map<string, CounterSnapshot>();

  constructor(private readonly options: CounterOptions) {}

  inc(labels: LabelValues, value = 1) {
    const key = serializeLabels(this.options.labelNames, labels);
    const current = this.values.get(key) ?? { labels: labelsForOutput(this.options.labelNames, labels), value: 0 };
    current.value += value;
    this.values.set(key, current);
  }

  render(): string {
    const lines = [`# HELP ${this.options.name} ${this.options.help}`, `# TYPE ${this.options.name} counter`];
    for (const snap of this.values.values()) {
      lines.push(formatMetricLine(this.options.name, snap.labels, snap.value));
    }
    return lines.join("\n");
  }
}

class Histogram {
  private readonly data = new Map<string, HistogramSnapshot>();

  constructor(private readonly options: HistogramOptions) {}

  observe(labels: LabelValues, value: number) {
    const key = serializeLabels(this.options.labelNames, labels);
    const entry = this.data.get(key) ?? {
      labels: labelsForOutput(this.options.labelNames, labels),
      buckets: this.options.buckets.map((bucket) => ({ le: bucket, value: 0 })),
      sum: 0,
      count: 0,
    };
    entry.sum += value;
    entry.count += 1;
    for (const bucket of entry.buckets) {
      if (value <= (bucket.le as number)) {
        bucket.value += 1;
      }
    }
    let infBucket = entry.buckets.find((b) => b.le === "+Inf");
    if (!infBucket) {
      infBucket = { le: "+Inf", value: 0 };
      entry.buckets.push(infBucket);
    }
    infBucket.value += 1;
    this.data.set(key, entry);
  }

  render(): string {
    const lines = [`# HELP ${this.options.name} ${this.options.help}`, `# TYPE ${this.options.name} histogram`];
    for (const snap of this.data.values()) {
      for (const bucket of snap.buckets) {
        lines.push(
          formatMetricLine(
            `${this.options.name}_bucket`,
            { ...snap.labels, le: String(bucket.le) },
            bucket.value
          )
        );
      }
      lines.push(formatMetricLine(`${this.options.name}_sum`, snap.labels, snap.sum));
      lines.push(formatMetricLine(`${this.options.name}_count`, snap.labels, snap.count));
    }
    return lines.join("\n");
  }
}

function serializeLabels(labelNames: string[], labels: LabelValues) {
  return labelNames.map((name) => `${name}:${labels[name] ?? ""}`).join("|");
}

function labelsForOutput(labelNames: string[], labels: LabelValues): LabelValues {
  const out: LabelValues = {};
  for (const name of labelNames) {
    if (labels[name] !== undefined) {
      out[name] = labels[name];
    }
  }
  return out;
}

function formatMetricLine(name: string, labels: LabelValues, value: number) {
  const labelEntries = Object.entries(labels);
  if (labelEntries.length === 0) {
    return `${name} ${value}`;
  }
  const renderedLabels = labelEntries
    .map(([key, val]) => `${key}="${String(val).replace(/"/g, '\\"')}"`)
    .join(",");
  return `${name}{${renderedLabels}} ${value}`;
}

export class MetricsRegistry {
  readonly contentType = "text/plain; version=0.0.4";
  private readonly counters: Counter[] = [];
  private readonly histograms: Histogram[] = [];
  private processStart = Date.now();

  setProcessStart(timestamp: number) {
    this.processStart = timestamp;
  }

  createCounter(options: CounterOptions) {
    const counter = new Counter(options);
    this.counters.push(counter);
    return counter;
  }

  createHistogram(options: HistogramOptions) {
    const histogram = new Histogram(options);
    this.histograms.push(histogram);
    return histogram;
  }

  metrics() {
    const sections: string[] = [];
    sections.push(`# HELP process_uptime_seconds Process uptime in seconds`);
    sections.push(`# TYPE process_uptime_seconds gauge`);
    const uptimeSeconds = (Date.now() - this.processStart) / 1000;
    sections.push(`process_uptime_seconds ${uptimeSeconds}`);
    for (const counter of this.counters) {
      sections.push(counter.render());
    }
    for (const histogram of this.histograms) {
      sections.push(histogram.render());
    }
    return sections.join("\n");
  }
}

export function collectDefaultMetrics(registry: MetricsRegistry) {
  registry.setProcessStart(Date.now());
}

export function createCounter(registry: MetricsRegistry, options: CounterOptions) {
  return registry.createCounter(options);
}

export function createHistogram(registry: MetricsRegistry, options: HistogramOptions) {
  return registry.createHistogram(options);
}
