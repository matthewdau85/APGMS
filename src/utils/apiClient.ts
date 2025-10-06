import { toast } from "react-hot-toast";

export type RequestConfig = RequestInit & {
  successMessage?: string;
  failureMessage?: string;
};

function resolveErrorMessage(action: string, error: unknown, fallback?: string) {
  if (error instanceof Error) {
    return `${action} failed: ${error.message}`;
  }
  return fallback ?? `${action} failed`;
}

export async function apiRequest<T>(input: RequestInfo, init: RequestConfig = {}): Promise<T> {
  const { successMessage, failureMessage, ...requestInit } = init;

  try {
    const response = await fetch(input, {
      headers: {
        "Content-Type": "application/json",
        ...(requestInit.headers || {}),
      },
      ...requestInit,
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || response.statusText || "Request failed");
      throw error;
    }

    const hasBody = response.status !== 204;
    const data = (hasBody ? await response.json() : undefined) as T;

    if (successMessage) {
      toast.success(successMessage);
    }

    return data;
  } catch (error) {
    const message = resolveErrorMessage("Request", error, failureMessage);
    toast.error(message);
    console.error("[apiRequest]", error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function withApiErrorToast<TArgs extends unknown[], TResult>(
  action: string,
  fn: (...args: TArgs) => Promise<TResult> | TResult
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = resolveErrorMessage(action, error);
      toast.error(message);
      console.error(`[${action}]`, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  };
}
