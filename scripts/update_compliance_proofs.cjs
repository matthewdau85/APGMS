#!/usr/bin/env node
/**
 * Build the DSP proof bundle used by the /ops/compliance/proofs endpoint
 * and emitted as a daily compliance artifact.
 */
const fs = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const PRACTICE_LOG = path.join(ROOT, 'ops', 'compliance', 'practice_log.json');
const PROOFS_PATH = path.join(ROOT, 'ops', 'compliance', 'proofs.json');
const REPORT_DIR = path.join(ROOT, 'ops', 'compliance', 'reports');
const FIXTURE_METRICS = path.join(ROOT, 'ops', 'compliance', 'fixtures', 'metrics.prom');
const PENTEST_PATH = path.join(ROOT, 'ops', 'compliance', 'pentest', 'latest_pentest.pdf');

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

function withinDays(dateStr, days) {
  const now = new Date();
  const target = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00Z'));
  const diff = (now - target) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

function parseRecentSum(entries, key) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  return entries
    .map(e => ({ ...e, date: new Date(e.date + (e.date.includes('T') ? '' : 'T00:00:00Z')) }))
    .filter(e => e.date >= cutoff)
    .reduce((acc, e) => acc + Number(e[key] || 0), 0);
}

async function fetchMetrics(urlStr) {
  if (!urlStr) return null;
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(url, res => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`metrics request failed with status ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error('metrics request timed out'));
    });
  });
}

async function ensureMetricsSnapshot() {
  const metricsUrl = process.env.METRICS_URL;
  let contents;
  try {
    contents = await fetchMetrics(metricsUrl);
  } catch (err) {
    console.warn(`Falling back to fixture metrics: ${err.message}`);
  }
  if (!contents) {
    contents = await fs.readFile(FIXTURE_METRICS, 'utf8');
  }
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(REPORT_DIR, `metrics_${timestamp}.prom`);
  await fs.writeFile(snapshotPath, contents, 'utf8');
  return { snapshotPath, contents };
}

async function verifyPentestReport() {
  try {
    await fs.access(PENTEST_PATH);
    return true;
  } catch (err) {
    throw new Error('Latest pentest PDF missing at ops/compliance/pentest/latest_pentest.pdf');
  }
}

function formatAccessReviewStatus(entry) {
  if (!entry) return 'No access review logged';
  const status = withinDays(entry.completed_at, 35)
    ? 'Current'
    : 'Stale';
  const suffix = entry.github_issue ? ` (tracked via ${entry.github_issue})` : '';
  return `${status} – completed ${entry.completed_at}${suffix}`;
}

async function main() {
  const practice = await readJson(PRACTICE_LOG);

  const mfaStepups7d = parseRecentSum(practice.mfa_stepups || [], 'successes');
  const dualApprovals7d = parseRecentSum(practice.dual_approvals || [], 'count');

  const latestDlq = [...(practice.dead_letter_queue || [])]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-1)[0] || { open_messages: 0, mean_replay_latency_ms: 0 };

  const irDrSorted = [...(practice.ir_dr_drills || [])]
    .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
  const latestIrDr = irDrSorted.slice(-1)[0];
  if (!latestIrDr || !withinDays(latestIrDr.completed_at, 95)) {
    throw new Error('IR/DR drill evidence is older than 95 days.');
  }

  const accessReviewSorted = [...(practice.access_reviews || [])]
    .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
  const latestAccessReview = accessReviewSorted.slice(-1)[0];
  if (!latestAccessReview || !withinDays(latestAccessReview.completed_at, 35)) {
    throw new Error('Access review is older than 35 days.');
  }

  const pentestOk = await verifyPentestReport();
  const metrics = await ensureMetricsSnapshot();

  const lastPentestDate = practice.last_pentest?.completed_at || null;
  if (!lastPentestDate) {
    throw new Error('last_pentest.completed_at missing from practice log.');
  }

  const proofs = {
    generated_at: new Date().toISOString(),
    mfa_stepups_7d: mfaStepups7d,
    dual_approvals_7d: dualApprovals7d,
    dlq_count: Number(latestDlq.open_messages || 0),
    mean_replay_latency_ms: Number(latestDlq.mean_replay_latency_ms || 0),
    last_ir_dr_date: latestIrDr.completed_at,
    last_pentest_date: lastPentestDate,
    access_review_status: formatAccessReviewStatus(latestAccessReview)
  };

  await fs.writeFile(PROOFS_PATH, JSON.stringify(proofs, null, 2));

  const report = {
    ...proofs,
    checks: {
      access_review_current: withinDays(latestAccessReview.completed_at, 35),
      ir_dr_recent: withinDays(latestIrDr.completed_at, 95),
      pentest_report_present: pentestOk,
      metrics_snapshot: metrics.snapshotPath,
      access_review_issue: latestAccessReview.github_issue || null,
      ir_dr_evidence: latestIrDr.evidence || null,
      pentest_vendor: practice.last_pentest?.vendor || null
    },
    metrics_sample: metrics.contents
  };

  const reportPath = path.join(REPORT_DIR, `compliance_daily_${new Date().toISOString().split('T')[0]}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    reportPath,
    proofsPath: PROOFS_PATH,
    metricsSnapshot: metrics.snapshotPath
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
