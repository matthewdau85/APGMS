export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && typeof (err as Partial<HttpError>).status === 'number' && typeof (err as Partial<HttpError>).code === 'string';
}
