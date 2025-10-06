import { ReconModelDefinition, ReconModelNode, ReconModelTree, ReconScoreItemInput, ReconScoreResponse, ReconScoreResult, FactorContribution, FeatureVector } from "./types";

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function standardize(vector: number[], mean: number[], scale: number[]): number[] {
  return vector.map((value, index) => {
    const m = mean[index] ?? 0;
    const s = scale[index] ?? 1;
    if (!Number.isFinite(s) || Math.abs(s) < 1e-9) {
      return value - m;
    }
    return (value - m) / s;
  });
}

function buildFeatureVector(item: ReconScoreItemInput, model: ReconModelDefinition): FeatureVector {
  const phase = model.encoders.period_phase[item.period_phase] ?? -1;
  const channel = model.encoders.pay_channel[item.pay_channel] ?? -1;
  const mapped: Record<string, number> = {
    delta_abs: Math.abs(item.delta),
    delta_pct: Math.abs(item.delta_pct),
    age_days: Math.max(0, item.age_days),
    amount: Math.abs(item.amount),
    counterparty_freq: Math.max(0, item.counterparty_freq),
    crn_valid: item.crn_valid ? 1 : 0,
    historical_adjustments: Math.max(0, item.historical_adjustments),
    phase_code: phase,
    channel_code: channel,
    retry_count: Math.max(0, item.retry_count),
  };

  const values = model.features.map((feature) => mapped[feature] ?? 0);
  return { values, mapped };
}

function indexTrees(trees: ReconModelTree[]): ReconModelTree[] {
  return trees.map((tree) => ({
    ...tree,
    nodes: tree.nodes.map((node) => ({ ...node })),
  }));
}

function buildNodeIndex(nodes: ReconModelNode[]): Map<number, ReconModelNode> {
  const map = new Map<number, ReconModelNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

function evaluateTree(
  tree: ReconModelTree,
  features: number[],
  featureIndex: Record<string, number>
): { value: number; path: string[] } {
  const nodesById = buildNodeIndex(tree.nodes);
  const path: string[] = [];
  let current = nodesById.get(0);
  if (!current) {
    return { value: 0, path };
  }

  while (!current.leaf) {
    if (!current.feature) {
      break;
    }
    const featurePos = featureIndex[current.feature];
    if (featurePos === undefined) {
      break;
    }
    const featureValue = features[featurePos];
    const threshold = current.threshold ?? 0;
    path.push(current.feature);
    const nextId = featureValue <= threshold ? current.left : current.right;
    if (nextId === undefined) {
      break;
    }
    const next = nodesById.get(nextId);
    if (!next) {
      break;
    }
    current = next;
  }

  const value = current.value ?? 0;
  return { value, path };
}

function scoreWithGradientBoosting(
  model: ReconModelDefinition,
  standardized: number[]
): { score: number; raw: number; contributions: Record<string, number> } {
  const gb = model.gradient_boosting;
  const contributions: Record<string, number> = {};
  const featureIndex = model.features.reduce<Record<string, number>>((acc, feature, idx) => {
    acc[feature] = idx;
    return acc;
  }, {});

  if (!gb || gb.trees.length === 0) {
    return scoreWithLogistic(model, standardized);
  }

  let raw = gb.base_score;
  const trees = indexTrees(gb.trees);
  for (const tree of trees) {
    const { value, path } = evaluateTree(tree, standardized, featureIndex);
    const lr = tree.learning_rate ?? 1;
    const contribution = lr * value;
    raw += contribution;
    const attribution = path.length > 0 ? contribution / path.length : contribution;
    for (const feature of path) {
      contributions[feature] = (contributions[feature] ?? 0) + attribution;
    }
  }

  return { score: logistic(raw), raw, contributions };
}

function scoreWithLogistic(
  model: ReconModelDefinition,
  standardized: number[]
): { score: number; raw: number; contributions: Record<string, number> } {
  const intercept = model.fallback.intercept ?? 0;
  const coefficients = model.fallback.coefficients ?? {};
  let raw = intercept;
  const contributions: Record<string, number> = {};

  model.features.forEach((feature, idx) => {
    const weight = coefficients[feature] ?? 0;
    const impact = weight * standardized[idx];
    contributions[feature] = impact;
    raw += impact;
  });

  return { score: logistic(raw), raw, contributions };
}

function describeContribution(feature: string, item: ReconScoreItemInput, direction: "positive" | "negative"): string {
  switch (feature) {
    case "delta_abs":
      return `${direction === "positive" ? "Large" : "Small"} delta of $${Math.abs(item.delta).toFixed(0)}`;
    case "delta_pct":
      return `${direction === "positive" ? "High" : "Low"} variance of ${(Math.abs(item.delta_pct) * 100).toFixed(1)}%`;
    case "age_days":
      return `${item.age_days} days outstanding`;
    case "amount":
      return `Amount $${Math.abs(item.amount).toFixed(0)}`;
    case "counterparty_freq":
      return `${item.counterparty_freq} counterparty hits in 90d`;
    case "crn_valid":
      return item.crn_valid ? "Valid CRN on file" : "Missing or invalid CRN";
    case "historical_adjustments":
      return `${item.historical_adjustments} prior adjustments`;
    case "phase_code":
      return `Period phase: ${item.period_phase}`;
    case "channel_code":
      return `Channel: ${item.pay_channel}`;
    case "retry_count":
      return `${item.retry_count} retries recorded`;
    default:
      return feature;
  }
}

function toFactorList(
  contributions: Record<string, number>,
  item: ReconScoreItemInput
): FactorContribution[] {
  const entries = Object.entries(contributions)
    .filter(([, impact]) => Number.isFinite(impact) && Math.abs(impact) > 1e-3)
    .map(([feature, impact]) => {
      const direction: "positive" | "negative" = impact >= 0 ? "positive" : "negative";
      return {
        feature,
        impact,
        direction,
        description: describeContribution(feature, item, direction),
      };
    })
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return entries.slice(0, 5);
}

function riskBand(score: number): "high" | "medium" | "low" {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

export function scoreItems(model: ReconModelDefinition, items: ReconScoreItemInput[]): ReconScoreResponse {
  const scored: ReconScoreResult[] = items.map((item) => {
    const vector = buildFeatureVector(item, model);
    const standardized = standardize(vector.values, model.scaler.mean, model.scaler.scale);
    const { score, contributions } = scoreWithGradientBoosting(model, standardized);
    const top_factors = toFactorList(contributions, item);
    return {
      id: item.id,
      score,
      risk_band: riskBand(score),
      top_factors,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return {
    model_version: model.model_version,
    scored,
  };
}
