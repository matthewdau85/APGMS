export interface RequestErrorOptions {
  requestId: string;
  status?: number;
  url?: string;
  cause?: unknown;
}

export class RequestError extends Error {
  readonly requestId: string;
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, options: RequestErrorOptions) {
    super(message);
    this.name = "RequestError";
    this.requestId = options.requestId;
    this.status = options.status;
    this.url = options.url;
    if (options.cause) {
      // Assign cause for better stack traces when supported
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isRequestError(error: unknown): error is RequestError {
  return error instanceof RequestError;
}

export function toRequestError(
  error: unknown,
  fallbackMessage: string,
  options: RequestErrorOptions,
): RequestError {
  if (error instanceof RequestError) {
    return error;
  }
  const message = error instanceof Error && error.message ? error.message : fallbackMessage;
  return new RequestError(message, { ...options, cause: error });
}
