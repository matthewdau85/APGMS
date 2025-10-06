export interface TrainingSample {
  entity_id: string;
  as_of: string;
  features: Record<string, number>;
  label: number;
}

export interface TrainedModel {
  weights: number[];
  featureNames: string[];
  bias: number;
}

export interface TrainingResult {
  model: TrainedModel;
  metrics: Record<string, number>;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);

  for (let i = 0; i < n; i += 1) {
    let pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-8) {
      for (let j = i + 1; j < n; j += 1) {
        if (Math.abs(augmented[j][i]) > Math.abs(pivot)) {
          [augmented[i], augmented[j]] = [augmented[j], augmented[i]];
          break;
        }
      }
      pivot = augmented[i][i];
    }

    const pivotInverse = 1 / pivot;
    for (let k = i; k <= n; k += 1) {
      augmented[i][k] *= pivotInverse;
    }

    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const factor = augmented[j][i];
      for (let k = i; k <= n; k += 1) {
        augmented[j][k] -= factor * augmented[i][k];
      }
    }
  }

  return augmented.map((row) => row[n]);
}

function addBias(samples: TrainingSample[], featureNames: string[]): number[][] {
  return samples.map((sample) => [1, ...featureNames.map((name) => sample.features[name] ?? 0)]);
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

export function trainRidgeRegression(
  samples: TrainingSample[],
  featureNames: string[],
  lambda = 1e-3
): TrainingResult {
  if (!samples.length) {
    throw new Error('No training samples provided');
  }

  const design = addBias(samples, featureNames);
  const target = samples.map((sample) => sample.label);

  const rows = design.length;
  const cols = design[0].length;

  const xtx: number[][] = Array.from({ length: cols }, () => Array(cols).fill(0));
  const xty: number[] = Array(cols).fill(0);

  for (let r = 0; r < rows; r += 1) {
    for (let c1 = 0; c1 < cols; c1 += 1) {
      xty[c1] += design[r][c1] * target[r];
      for (let c2 = 0; c2 < cols; c2 += 1) {
        xtx[c1][c2] += design[r][c1] * design[r][c2];
      }
    }
  }

  for (let i = 1; i < cols; i += 1) {
    xtx[i][i] += lambda;
  }

  const weights = solveLinearSystem(xtx, xty);
  const bias = weights[0];
  const coefficients = weights.slice(1);

  const predictions = design.map((row) => sigmoid(row.reduce((acc, value, idx) => acc + value * weights[idx], 0)));
  const predictedLabels = predictions.map((value) => (value >= 0.5 ? 1 : 0));

  const accuracy = predictedLabels.reduce((acc, value, idx) => acc + (value === target[idx] ? 1 : 0), 0) / rows;
  const mse = predictions.reduce((acc, value, idx) => {
    const diff = value - target[idx];
    return acc + diff * diff;
  }, 0) / rows;

  return {
    model: {
      weights: coefficients,
      featureNames,
      bias,
    },
    metrics: {
      accuracy: Number(accuracy.toFixed(4)),
      mse: Number(mse.toFixed(4)),
    },
  };
}
