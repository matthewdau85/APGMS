export type NumericVector = number[];

interface IsolationForestOptions {
  trees?: number;
  sampleSize?: number;
}

interface TreeNode {
  size?: number;
  featureIndex?: number;
  splitValue?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export class IsolationForest {
  private readonly trees: TreeNode[] = [];
  private readonly treeCount: number;
  private readonly requestedSampleSize: number;
  private maxDepth = 0;
  private normalizationFactor = 1;

  constructor(options: IsolationForestOptions = {}) {
    this.treeCount = Math.max(1, Math.floor(options.trees ?? 75));
    this.requestedSampleSize = Math.max(2, Math.floor(options.sampleSize ?? 64));
  }

  fit(dataset: NumericVector[]): void {
    if (!dataset.length) {
      this.trees.length = 0;
      this.normalizationFactor = 1;
      return;
    }

    const sampleSize = Math.min(this.requestedSampleSize, dataset.length);
    this.maxDepth = Math.ceil(Math.log2(sampleSize)) || 1;
    this.normalizationFactor = this.c(sampleSize);

    this.trees.length = 0;
    for (let i = 0; i < this.treeCount; i += 1) {
      const sample = this.randomSample(dataset, sampleSize);
      this.trees.push(this.buildTree(sample, 0));
    }
  }

  score(point: NumericVector): number {
    if (!this.trees.length) {
      return 0;
    }
    const totalPath = this.trees.reduce((sum, tree) => sum + this.pathLength(tree, point, 0), 0);
    const avgPath = totalPath / this.trees.length;
    const normalizer = this.normalizationFactor > 0 ? this.normalizationFactor : 1;
    const rawScore = Math.pow(2, -avgPath / normalizer);
    return Math.max(0, Math.min(1, rawScore));
  }

  private randomSample(dataset: NumericVector[], size: number): NumericVector[] {
    const shuffled = dataset.slice();
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, size);
  }

  private buildTree(points: NumericVector[], depth: number): TreeNode {
    if (points.length <= 1 || depth >= this.maxDepth) {
      return { size: points.length };
    }

    const dimension = points[0]?.length ?? 0;
    if (dimension === 0) {
      return { size: points.length };
    }

    const { featureIndex, min, max } = this.pickFeature(points, dimension);
    if (featureIndex === -1 || min === undefined || max === undefined || min >= max) {
      return { size: points.length };
    }

    const splitValue = min + this.random() * (max - min);
    let left: NumericVector[] = [];
    let right: NumericVector[] = [];
    for (const row of points) {
      if (row[featureIndex] <= splitValue) {
        left.push(row);
      } else {
        right.push(row);
      }
    }

    if (!left.length || !right.length) {
      const sorted = points.slice().sort((a, b) => a[featureIndex] - b[featureIndex]);
      const mid = Math.floor(sorted.length / 2);
      left = sorted.slice(0, mid);
      right = sorted.slice(mid);
      if (!left.length || !right.length) {
        return { size: points.length };
      }
    }

    return {
      featureIndex,
      splitValue,
      left: this.buildTree(left, depth + 1),
      right: this.buildTree(right, depth + 1),
    };
  }

  private pickFeature(points: NumericVector[], dimension: number): { featureIndex: number; min?: number; max?: number } {
    const tried = new Set<number>();
    while (tried.size < dimension) {
      const idx = Math.floor(this.random() * dimension);
      if (tried.has(idx)) {
        continue;
      }
      tried.add(idx);
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const row of points) {
        const value = row[idx];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (min < max) {
        return { featureIndex: idx, min, max };
      }
    }
    return { featureIndex: -1 };
  }

  private pathLength(node: TreeNode | undefined, point: NumericVector, depth: number): number {
    if (!node) {
      return depth;
    }
    if (typeof node.size === "number") {
      return depth + this.c(node.size);
    }
    if (node.featureIndex === undefined || node.splitValue === undefined) {
      return depth;
    }
    if (point[node.featureIndex] <= node.splitValue) {
      return this.pathLength(node.left, point, depth + 1);
    }
    return this.pathLength(node.right, point, depth + 1);
  }

  private c(n: number): number {
    if (n <= 1) {
      return 0;
    }
    return 2 * (this.harmonic(n - 1)) - (2 * (n - 1)) / n;
  }

  private harmonic(n: number): number {
    if (n <= 0) {
      return 0;
    }
    return Math.log(n) + 0.5772156649 + 1 / (2 * n) - 1 / (12 * n * n);
  }

  private random(): number {
    return Math.random();
  }
}
