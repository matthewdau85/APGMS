import EventEmitter from "node:events";

export interface AdapterQueueMetrics {
  name: string;
  active: number;
  size: number;
  dropped: number;
  processed: number;
  retries: number;
  maxSize: number;
  concurrency: number;
  createdAt: number;
}

interface QueueTask<TPayload, TResult> {
  attempt: number;
  payload: TPayload;
  execute: () => Promise<TResult>;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: unknown) => void;
}

export class AdapterBackpressureError extends Error {
  constructor(public readonly queueName: string, public readonly size: number, public readonly limit: number) {
    super(`Queue ${queueName} saturated (size=${size}, limit=${limit})`);
    this.name = "AdapterBackpressureError";
  }
}

export interface AdapterQueueOptions<TPayload> {
  name: string;
  concurrency: number;
  maxQueue: number;
  retryAttempts: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs?: number;
  shouldRetry?: (err: unknown, payload: TPayload) => boolean;
  onPermanentFailure?: (err: unknown, payload: TPayload, attempts: number) => Promise<void> | void;
}

export class AdapterQueue<TPayload = unknown, TResult = unknown> extends EventEmitter {
  private readonly queue: QueueTask<TPayload, TResult>[] = [];
  private active = 0;
  private dropped = 0;
  private processed = 0;
  private retries = 0;
  private readonly metrics: AdapterQueueMetrics;

  constructor(private readonly options: AdapterQueueOptions<TPayload>) {
    super();
    this.metrics = {
      name: options.name,
      active: 0,
      size: 0,
      dropped: 0,
      processed: 0,
      retries: 0,
      maxSize: options.maxQueue,
      concurrency: options.concurrency,
      createdAt: Date.now(),
    };
  }

  enqueue(payload: TPayload, handler: () => Promise<TResult>): Promise<TResult> {
    if (this.queue.length >= this.options.maxQueue) {
      this.dropped += 1;
      this.updateMetrics();
      throw new AdapterBackpressureError(this.options.name, this.queue.length, this.options.maxQueue);
    }

    return new Promise<TResult>((resolve, reject) => {
      const task: QueueTask<TPayload, TResult> = {
        attempt: 0,
        payload,
        execute: handler,
        resolve,
        reject,
      };
      this.queue.push(task);
      this.updateMetrics();
      this.drain();
    });
  }

  getMetrics(): AdapterQueueMetrics {
    return { ...this.metrics };
  }

  private drain() {
    while (this.active < this.options.concurrency && this.queue.length) {
      const task = this.queue.shift()!;
      this.runTask(task);
    }
  }

  private async runTask(task: QueueTask<TPayload, TResult>) {
    this.active += 1;
    task.attempt += 1;
    this.updateMetrics();

    try {
      const result = await task.execute();
      this.processed += 1;
      task.resolve(result);
    } catch (err) {
      if (task.attempt <= this.options.retryAttempts && this.shouldRetry(err, task.payload)) {
        this.retries += 1;
        const delay = this.computeDelay(task.attempt);
        this.updateMetrics();
        setTimeout(() => {
          this.queue.unshift(task);
          this.updateMetrics();
          this.drain();
        }, delay);
        return;
      }

      try {
        await this.options.onPermanentFailure?.(err, task.payload, task.attempt);
      } finally {
        task.reject(err);
      }
    } finally {
      if (this.active > 0) this.active -= 1;
      this.updateMetrics();
      if (this.queue.length) this.drain();
    }
  }

  private computeDelay(attempt: number): number {
    const base = this.options.baseRetryDelayMs;
    const max = this.options.maxRetryDelayMs ?? base * 16;
    const delay = Math.min(base * Math.pow(2, attempt - 1), max);
    return Math.max(delay, base);
  }

  private shouldRetry(err: unknown, payload: TPayload): boolean {
    if (!this.options.retryAttempts) return false;
    if (!this.options.shouldRetry) return true;
    try {
      return this.options.shouldRetry(err, payload);
    } catch {
      return false;
    }
  }

  private updateMetrics() {
    this.metrics.active = this.active;
    this.metrics.size = this.queue.length;
    this.metrics.dropped = this.dropped;
    this.metrics.processed = this.processed;
    this.metrics.retries = this.retries;
    this.emit("metrics", this.getMetrics());
  }
}

const queues = new Set<AdapterQueue<any, any>>();

export function registerQueue<TPayload, TResult>(queue: AdapterQueue<TPayload, TResult>) {
  queues.add(queue);
  queue.on("metrics", () => {
    // noop listener just to keep emitter active
  });
}

export function getAdapterQueueMetrics(): AdapterQueueMetrics[] {
  return Array.from(queues, (queue) => queue.getMetrics());
}
