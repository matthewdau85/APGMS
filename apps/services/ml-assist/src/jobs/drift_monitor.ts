import path from 'node:path';
import fs from 'node:fs/promises';

import { FeatureStore } from '../lib/featureStore';
import { ensureSyntheticFeatures } from '../lib/featureBuilders';
import { buildTrainingSamples, FEATURE_NAMES } from '../lib/dataset';

interface BaselineFeature {
  bin_edges: number[];
  reference_perc: number[];
  sample_size: number;
}

interface BaselineFile {
  created_at: string;
  features: Record<string, BaselineFeature>;
}

interface DriftReportEntry {
  psi: number;
  reference_perc: number[];
  current_perc: number[];
}

interface DriftReport {
  run_at: string;
  samples: number;
  psi: Record<string, DriftReportEntry>;
}

const BIN_COUNT = 5;
const DRIFT_THRESHOLD = 0.25;
const BASELINE_PATH = path.join('apps/services/ml-assist/feature_store', 'baselines.json');
const REPORT_DIR = path.join('apps/services/ml-assist/drift/reports');
const ISSUE_DIR = path.join('apps/services/ml-assist/drift/issues');

function computeBins(values: number[]): number[] {
  if (!values.length) {
    return [0, 1];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const epsilon = Math.max(1e-6, (max - min) * 0.001);
  const edges: number[] = [min - epsilon];

  for (let i = 1; i < BIN_COUNT; i += 1) {
    const quantileIndex = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * (i / BIN_COUNT)));
    edges.push(sorted[quantileIndex]);
  }

  edges.push(max + epsilon);
  return edges;
}

function histogram(values: number[], edges: number[]): number[] {
  const counts = Array(edges.length - 1).fill(0);
  for (const value of values) {
    const index = edges.findIndex((edge, idx) => idx < edges.length - 1 && value >= edge && value < edges[idx + 1]);
    const safeIndex = index === -1 ? counts.length - 1 : index;
    counts[safeIndex] += 1;
  }
  return counts;
}

function toPercentages(counts: number[]): number[] {
  const total = counts.reduce((acc, value) => acc + value, 0);
  const adjustedTotal = total + counts.length * 1e-6;
  return counts.map((count) => (count + 1e-6) / adjustedTotal);
}

function buildBaselineFeature(values: number[]): BaselineFeature {
  if (!values.length) {
    return {
      bin_edges: [0, 1],
      reference_perc: [1],
      sample_size: 0,
    };
  }
  const edges = computeBins(values);
  const counts = histogram(values, edges);
  return {
    bin_edges: edges,
    reference_perc: toPercentages(counts),
    sample_size: values.length,
  };
}

async function loadBaseline(): Promise<BaselineFile | null> {
  try {
    const raw = await fs.readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(raw) as BaselineFile;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function saveBaseline(baseline: BaselineFile): Promise<void> {
  await fs.mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await fs.writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

function calculatePsi(referencePerc: number[], currentPerc: number[]): number {
  let psi = 0;
  for (let i = 0; i < referencePerc.length; i += 1) {
    const ref = referencePerc[i] || 1e-6;
    const cur = currentPerc[i] || 1e-6;
    psi += (cur - ref) * Math.log(cur / ref);
  }
  return Number(psi.toFixed(4));
}

function computeDriftReport(baseline: BaselineFile, currentValues: Record<string, number[]>): DriftReport {
  const psi: Record<string, DriftReportEntry> = {};

  for (const [featureName, baselineFeature] of Object.entries(baseline.features)) {
    const values = currentValues[featureName] ?? [];
    const counts = histogram(values, baselineFeature.bin_edges);
    const currentPerc = toPercentages(counts);
    psi[featureName] = {
      psi: calculatePsi(baselineFeature.reference_perc, currentPerc),
      reference_perc: baselineFeature.reference_perc,
      current_perc: currentPerc,
    };
  }

  return {
    run_at: new Date().toISOString(),
    samples: Object.values(currentValues)[0]?.length ?? 0,
    psi,
  };
}

async function writeReport(report: DriftReport): Promise<string> {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const filename = `psi_report_${report.run_at.replace(/[:.]/g, '-')}.json`;
  const filePath = path.join(REPORT_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2));
  return filePath;
}

async function openIssue(report: DriftReport, offenders: Array<[string, DriftReportEntry]>): Promise<string> {
  await fs.mkdir(ISSUE_DIR, { recursive: true });
  const filename = `drift_${report.run_at.replace(/[:.]/g, '-')}.md`;
  const filePath = path.join(ISSUE_DIR, filename);
  const lines = [
    '# Drift Alert',
    '',
    `Detected ${offenders.length} feature(s) with PSI above ${DRIFT_THRESHOLD}.`,
    '',
    '| Feature | PSI | Reference % | Current % |',
    '| --- | --- | --- | --- |',
  ];

  for (const [feature, entry] of offenders) {
    lines.push(
      `| ${feature} | ${entry.psi.toFixed(4)} | ${entry.reference_perc.map((v) => v.toFixed(3)).join(', ')} | ${entry.current_perc
        .map((v) => v.toFixed(3))
        .join(', ')} |`
    );
  }

  lines.push('', 'Please investigate the upstream data sources.');
  await fs.writeFile(filePath, lines.join('\n'));
  return filePath;
}

async function main() {
  const store = new FeatureStore();
  await store.init();
  await ensureSyntheticFeatures(store);

  const [reconRows, bankRows, liabilityRows] = await Promise.all([
    store.readFeatureSet('recon'),
    store.readFeatureSet('bank'),
    store.readFeatureSet('liability'),
  ]);

  await store.close();

  const trainingSamples = buildTrainingSamples({
    recon: reconRows,
    bank: bankRows,
    liability: liabilityRows,
  });

  if (!trainingSamples.length) {
    throw new Error('No samples available for drift computation.');
  }

  const valueMap: Record<string, number[]> = {};
  for (const featureName of FEATURE_NAMES) {
    valueMap[featureName] = [];
  }

  for (const sample of trainingSamples) {
    for (const featureName of FEATURE_NAMES) {
      const value = sample.features[featureName];
      if (typeof value === 'number' && Number.isFinite(value)) {
        valueMap[featureName].push(value);
      }
    }
  }

  const baseline = await loadBaseline();

  if (!baseline) {
    const featureBaselines: Record<string, BaselineFeature> = {};
    for (const featureName of FEATURE_NAMES) {
      featureBaselines[featureName] = buildBaselineFeature(valueMap[featureName] ?? []);
    }

    const file: BaselineFile = {
      created_at: new Date().toISOString(),
      features: featureBaselines,
    };

    await saveBaseline(file);
    console.log('Baseline created for drift monitoring. No PSI computed on first run.');
    return;
  }

  const report = computeDriftReport(baseline, valueMap);
  const reportPath = await writeReport(report);
  console.log(`Drift report written to ${reportPath}`);

  const offenders = Object.entries(report.psi).filter(([, entry]) => entry.psi > DRIFT_THRESHOLD);
  if (offenders.length) {
    const issuePath = await openIssue(report, offenders);
    console.log(`Drift threshold exceeded. Issue stub created at ${issuePath}`);
  } else {
    console.log('No features breached the PSI threshold.');
  }
}

main().catch((error) => {
  console.error('Drift monitor failed', error);
  process.exitCode = 1;
});
