function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  jitter?: boolean;
};

export async function executeWithRetry<T>(operation: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 250;
  let lastError: any;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const backoff = baseDelay * Math.pow(2, attempt - 1);
      const jitter = opts.jitter ? Math.floor(Math.random() * baseDelay) : 0;
      await sleep(backoff + jitter);
    }
  }

  throw lastError;
}
