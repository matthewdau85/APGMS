// scripts/ops/pager_hook.ts
// Simple stub that polls the SLO endpoint and prints whether a pager would fire.

type SloSnapshot = {
  p95ReleaseMs: number;
  releaseErrorRate: number;
  dlqDepth: number;
  reconLagSec: number;
};

function describeBreaches(slo: SloSnapshot): string[] {
  const breaches: string[] = [];
  if (slo.p95ReleaseMs > 5_000) breaches.push(`p95ReleaseMs ${slo.p95ReleaseMs}ms > 5000ms`);
  if (slo.releaseErrorRate > 0.05) breaches.push(`releaseErrorRate ${(slo.releaseErrorRate * 100).toFixed(2)}% > 5%`);
  if (slo.dlqDepth > 0) breaches.push(`dlqDepth ${slo.dlqDepth} > 0`);
  if (slo.reconLagSec > 300) breaches.push(`reconLagSec ${slo.reconLagSec}s > 300s`);
  return breaches;
}

async function fetchSlo(url: string): Promise<SloSnapshot> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch SLOs (${res.status})`);
  }
  return (await res.json()) as SloSnapshot;
}

async function main() {
  const url = process.argv[2] ?? 'http://localhost:3000/ops/slo';
  try {
    const slo = await fetchSlo(url);
    const breaches = describeBreaches(slo);
    if (breaches.length) {
      console.log(`PAGER would trigger: ${breaches.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('Pager hook: all clear');
    }
  } catch (err) {
    console.error('Pager hook failed', err);
    process.exitCode = 2;
  }
}

void main();
