import { Router } from "express";
import { IsolationForest } from "../anomaly/isolationForest";
import { prepareReconEvents, ReconEventInput } from "../anomaly/featureEngineering";

const DEFAULT_DUPLICATE_WEIGHT = 0.75;

export const mlReconRouter = Router();

mlReconRouter.post("/recon/unsupervised", (req, res) => {
  try {
    const payload = (req.body?.events ?? []) as ReconEventInput[];
    if (!Array.isArray(payload) || !payload.length) {
      return res.status(400).json({ error: "events array required" });
    }

    const prepared = prepareReconEvents(payload);
    if (!prepared.length) {
      return res.status(400).json({ error: "no usable events" });
    }

    const forest = new IsolationForest({
      trees: Math.min(150, Math.max(50, prepared.length * 2)),
      sampleSize: Math.min(128, Math.max(16, Math.floor(prepared.length * 0.75))),
    });

    forest.fit(prepared.map((event) => event.vector));

    const duplicates = new Map<string, number>();
    for (const event of prepared) {
      duplicates.set(event.duplicateKey, (duplicates.get(event.duplicateKey) ?? 0) + 1);
    }

    const results = prepared.map((event) => {
      const isolationScore = forest.score(event.vector);
      const dupCount = duplicates.get(event.duplicateKey) ?? 1;
      const duplicateScore = dupCount > 1 ? 1 - Math.exp(-DEFAULT_DUPLICATE_WEIGHT * (dupCount - 1)) : 0;
      const anomaly_score = Math.min(1, Math.max(isolationScore, duplicateScore));
      return {
        id: event.id,
        anomaly_score: Number(anomaly_score.toFixed(4)),
        isolation_score: Number(isolationScore.toFixed(4)),
        duplicate_score: Number(duplicateScore.toFixed(4)),
      };
    });

    const ranked = results
      .slice()
      .sort((a, b) => b.anomaly_score - a.anomaly_score)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const rankedById = new Map(ranked.map((row) => [row.id, row.rank] as const));
    const decorated = results.map((row) => ({
      id: row.id,
      anomaly_score: row.anomaly_score,
      rank: rankedById.get(row.id),
      isolation_score: row.isolation_score,
      duplicate_score: row.duplicate_score,
    }));

    return res.json(decorated);
  } catch (error: any) {
    return res.status(500).json({ error: "unsupervised detection failed", detail: String(error?.message ?? error) });
  }
});
