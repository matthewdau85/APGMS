import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ModelMetadata {
  model_name: string;
  version: string;
  training_data_hash: string;
  metrics: Record<string, number>;
  created_at: string;
  artifact_path: string;
}

interface RegistryFile {
  models: ModelMetadata[];
}

export class ModelRegistry {
  private registryPath: string;
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), 'models');
    this.registryPath = path.join(this.baseDir, 'metadata.json');
  }

  private async loadRegistry(): Promise<RegistryFile> {
    try {
      const raw = await fs.readFile(this.registryPath, 'utf8');
      return JSON.parse(raw) as RegistryFile;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { models: [] };
      }
      throw error;
    }
  }

  private async saveRegistry(registry: RegistryFile): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.registryPath, JSON.stringify(registry, null, 2));
  }

  private static formatVersion(versionNumber: number): string {
    return `v${versionNumber.toString().padStart(3, '0')}`;
  }

  private nextVersion(registry: RegistryFile, modelName: string): string {
    const versions = registry.models
      .filter((entry) => entry.model_name === modelName)
      .map((entry) => parseInt(entry.version.replace(/^v/, ''), 10))
      .filter((num) => !Number.isNaN(num));
    const next = versions.length ? Math.max(...versions) + 1 : 1;
    return ModelRegistry.formatVersion(next);
  }

  async registerModel(options: {
    modelName: string;
    artifact: unknown;
    trainingData: unknown;
    metrics: Record<string, number>;
  }): Promise<ModelMetadata> {
    const registry = await this.loadRegistry();
    const version = this.nextVersion(registry, options.modelName);
    const modelDir = path.join(this.baseDir, options.modelName, version);
    const artifactPath = path.join(modelDir, 'model.json');
    const createdAt = new Date().toISOString();

    await fs.mkdir(modelDir, { recursive: true });
    await fs.writeFile(artifactPath, JSON.stringify(options.artifact, null, 2));

    const metadata: ModelMetadata = {
      model_name: options.modelName,
      version,
      training_data_hash: this.hashTrainingData(options.trainingData),
      metrics: options.metrics,
      created_at: createdAt,
      artifact_path: path.relative(process.cwd(), artifactPath),
    };

    registry.models.push(metadata);
    await this.saveRegistry(registry);

    return metadata;
  }

  private hashTrainingData(trainingData: unknown): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(trainingData));
    return hash.digest('hex');
  }
}
