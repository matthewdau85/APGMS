// apps/services/payments/src/routes/ml.ts
import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';

import { pool } from '../db.js';

interface CanaryConfig {
  enabled: boolean;
  version: string | null;
  percent: number;
  salt: string;
}

interface AssignmentResult {
  modelVersion: string;
  activeVersion: string;
  shadowVersion: string | null;
  inCanary: boolean;
  canaryPercent: number;
}

const router = Router();

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
}

function parsePercent(value: string | undefined, fallback = 0.1): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, 0), 1);
}

function getCanaryConfig(): CanaryConfig {
  const configuredVersion = process.env.ML_CANARY_VERSION || null;
  const enabled = parseBoolean(process.env.ML_CANARY_ENABLED, false) && !!configuredVersion;
  const flagToggle = (process.env.ML_CANARY_FLAG || '').toLowerCase();
  const forced = flagToggle === 'on' || flagToggle === 'true';
  const disabledByFlag = flagToggle === 'off';
  const finalEnabled = (enabled || forced) && !disabledByFlag && !!configuredVersion;
  return {
    enabled: finalEnabled,
    version: finalEnabled ? configuredVersion : null,
    percent: finalEnabled ? parsePercent(process.env.ML_CANARY_PERCENT, 0.1) : 0,
    salt: process.env.ML_CANARY_SALT || 'apgms-canary-salt',
  };
}

async function fetchActiveModelVersion(): Promise<string> {
  try {
    const { rows } = await pool.query<{ version: string }>(
      `SELECT version FROM ml_model_versions WHERE is_active = true ORDER BY created_at DESC LIMIT 1`
    );
    if (rows.length) {
      return rows[0].version;
    }
  } catch (err) {
    console.error('[ml] failed to fetch active model version', err);
  }
  return process.env.ML_MODEL_VERSION || process.env.ML_BASE_MODEL_VERSION || 'scorer_v1';
}

function assignModel(userIdHash: string | undefined, baseVersion: string, canary: CanaryConfig): AssignmentResult {
  const sanitized = typeof userIdHash === 'string' ? userIdHash : '';
  let inCanary = false;
  if (sanitized && canary.enabled && canary.version) {
    const digest = crypto.createHash('sha256').update(sanitized + canary.salt).digest();
    const bucket = digest.readUInt32BE(0) / 0xffffffff;
    inCanary = bucket < canary.percent;
  }
  return {
    modelVersion: inCanary && canary.version ? canary.version : baseVersion,
    activeVersion: baseVersion,
    shadowVersion: canary.enabled ? canary.version : null,
    inCanary,
    canaryPercent: canary.enabled ? canary.percent : 0,
  };
}

router.get('/assignment', async (req: Request, res: Response) => {
  try {
    const userIdHash = typeof req.query.userIdHash === 'string' ? req.query.userIdHash : '';
    if (!userIdHash) {
      return res.status(400).json({ error: 'userIdHash is required' });
    }
    const baseVersion = await fetchActiveModelVersion();
    const canary = getCanaryConfig();
    const assignment = assignModel(userIdHash, baseVersion, canary);
    res.json({
      ...assignment,
      canaryEnabled: canary.enabled,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'assignment_failed', detail: err?.message || String(err) });
  }
});

router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const baseVersion = await fetchActiveModelVersion();
    const canary = getCanaryConfig();
    const perVersion = await pool.query<{
      model_version: string | null;
      total: string;
      accepted: string | null;
      median_latency_ms: string | null;
    }>(
      `
      SELECT
        model_version,
        COUNT(*)::bigint AS total,
        SUM(CASE WHEN accepted THEN 1 ELSE 0 END)::bigint AS accepted,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_latency_ms
      FROM ml_decisions
      GROUP BY model_version
      ORDER BY model_version
      `
    );
    const overall = await pool.query<{
      total: string;
      accepted: string | null;
      median_latency_ms: string | null;
    }>(
      `
      SELECT
        COUNT(*)::bigint AS total,
        SUM(CASE WHEN accepted THEN 1 ELSE 0 END)::bigint AS accepted,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_latency_ms
      FROM ml_decisions
      `
    );

    const overallRow = overall.rows[0];
    const overallTotal = overallRow ? Number(overallRow.total || 0) : 0;
    const overallAccepted = overallRow ? Number(overallRow.accepted || 0) : 0;
    const overallMedian = overallRow && overallRow.median_latency_ms != null
      ? Number(overallRow.median_latency_ms)
      : null;

    res.json({
      updatedAt: new Date().toISOString(),
      activeModel: baseVersion,
      overall: {
        total: overallTotal,
        accepted: overallAccepted,
        acceptanceRate: overallTotal > 0 ? overallAccepted / overallTotal : 0,
        medianLatencyMs: overallMedian,
      },
      versions: perVersion.rows.map((row) => {
        const total = Number(row.total || 0);
        const accepted = Number(row.accepted || 0);
        return {
          modelVersion: row.model_version || 'unknown',
          total,
          accepted,
          acceptanceRate: total > 0 ? accepted / total : 0,
          medianLatencyMs: row.median_latency_ms != null ? Number(row.median_latency_ms) : null,
        };
      }),
      canary: {
        enabled: canary.enabled,
        version: canary.version,
        percent: canary.percent,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'metrics_failed', detail: err?.message || String(err) });
  }
});

router.post('/decisions', async (req: Request, res: Response) => {
  try {
    const {
      userIdHash,
      action,
      inputHash,
      suggested,
      chosen,
      accepted,
      latencyMs,
    } = req.body || {};

    if (!userIdHash || typeof userIdHash !== 'string') {
      return res.status(400).json({ error: 'userIdHash is required' });
    }
    if (!action || typeof action !== 'string') {
      return res.status(400).json({ error: 'action is required' });
    }
    if (!inputHash || typeof inputHash !== 'string') {
      return res.status(400).json({ error: 'inputHash is required' });
    }
    if (typeof accepted !== 'boolean') {
      return res.status(400).json({ error: 'accepted must be a boolean' });
    }
    const latency = Number(latencyMs);
    if (!Number.isFinite(latency) || latency < 0) {
      return res.status(400).json({ error: 'latencyMs must be a positive number' });
    }

    const baseVersion = await fetchActiveModelVersion();
    const canary = getCanaryConfig();
    const assignment = assignModel(userIdHash, baseVersion, canary);

    const suggestedPayload = (suggested && typeof suggested === 'object') ? { ...suggested } : {};
    if (!('model_version' in suggestedPayload) || !suggestedPayload.model_version) {
      suggestedPayload.model_version = assignment.modelVersion;
    }

    const chosenPayload = (chosen && typeof chosen === 'object') ? { ...chosen } : {};

    const insert = await pool.query<{ id: string; model_version: string | null }>(
      `
      INSERT INTO ml_decisions
        (user_id_hash, action, input_hash, suggested, chosen, accepted, latency_ms)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, model_version
      `,
      [userIdHash, action, inputHash, suggestedPayload, chosenPayload, accepted, Math.round(latency)]
    );

    res.status(201).json({
      id: Number(insert.rows[0].id),
      modelVersion: insert.rows[0].model_version || assignment.modelVersion,
      assignment,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'decision_log_failed', detail: err?.message || String(err) });
  }
});

export const mlRouter = router;
