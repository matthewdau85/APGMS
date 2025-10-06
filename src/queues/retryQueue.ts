export interface QueueState {
  depth: number;
  active: number;
  maxSize: number;
}

export interface RetryQueueOptions<TPayload, TResult> {
  concurrency: number;
  maxSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  processor: (payload: TPayload, attempt: number) => Promise<TResult>;
  onPermanentFailure: (payload: TPayload, error: unknown, attempts: number) => Promise<void> | void;
  onMetrics?: (state: QueueState) => void;
  onRetry?: (payload: TPayload, error: unknown, attempt: number) => void;
}

export class QueueSaturatedError extends Error {
  code = "QUEUE_SATURATED" as const;
  constructor(message = "Queue backlog is saturated") {
    super(message);
  }
}

export class DeadLetterError extends Error {
  code = "DEAD_LETTERED" as const;
  constructor(message = "Job permanently failed", public originalError?: unknown) {
    super(message);
  }
}

type Job<TPayload, TResult> = {
  payload: TPayload;
  attempts: number;
  resolve: (result: TResult) => void;
  reject: (error: unknown) => void;
};

export class RetryQueue<TPayload, TResult> {
  private queue: Job<TPayload, TResult>[] = [];
  private active = 0;

  constructor(private readonly options: RetryQueueOptions<TPayload, TResult>) {
    if (options.concurrency <= 0) throw new Error("concurrency must be positive");
    if (options.maxSize < 0) throw new Error("maxSize cannot be negative");
    if (options.maxAttempts <= 0) throw new Error("maxAttempts must be positive");
  }

  enqueue(payload: TPayload): Promise<TResult> {
    if (this.queue.length >= this.options.maxSize) {
      throw new QueueSaturatedError();
    }
    return new Promise<TResult>((resolve, reject) => {
      const job: Job<TPayload, TResult> = { payload, attempts: 0, resolve, reject };
      this.queue.push(job);
      this.publishMetrics();
      this.drain();
    });
  }

  snapshot(): QueueState {
    return { depth: this.queue.length, active: this.active, maxSize: this.options.maxSize };
  }

  private publishMetrics() {
    this.options.onMetrics?.(this.snapshot());
  }

  private drain() {
    while (this.active < this.options.concurrency && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      this.active++;
      this.publishMetrics();
      this.execute(job).finally(() => {
        this.active--;
        this.publishMetrics();
        this.drain();
      });
    }
  }

  private async execute(job: Job<TPayload, TResult>) {
    job.attempts += 1;
    try {
      const result = await this.options.processor(job.payload, job.attempts);
      job.resolve(result);
    } catch (err) {
      if (job.attempts < this.options.maxAttempts) {
        this.options.onRetry?.(job.payload, err, job.attempts);
        const delay = Math.min(
          this.options.maxBackoffMs,
          this.options.baseBackoffMs * Math.pow(2, job.attempts - 1)
        );
        setTimeout(() => {
          this.queue.push(job);
          this.publishMetrics();
          this.drain();
        }, delay);
      } else {
        await this.options.onPermanentFailure(job.payload, err, job.attempts);
        job.reject(new DeadLetterError("Release job sent to DLQ", err));
      }
    }
  }
}
