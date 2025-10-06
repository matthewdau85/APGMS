import { emitRequestTrace } from "../tracing/trace-emitter";
import { createRequestId } from "../utils/request-id";
import { RequestError, toRequestError } from "./errors";

export interface RequestOptions extends RequestInit {
  /**
   * When true the helper will attempt to parse JSON responses.
   * Defaults to true for convenience.
   */
  parseJson?: boolean;
  meta?: {
    /**
     * Optional friendly label for observability and user facing messaging.
     */
    label?: string;
    /**
     * Skip the automatic network error toast for this request.
     */
    skipGlobalErrorToast?: boolean;
  };
}

export interface RequestSuccess<T> {
  data: T;
  requestId: string;
  response: Response;
}

const HELPERS = {
  async parseResponse<T>(response: Response, parseJson: boolean): Promise<T> {
    if (!parseJson) {
      return (await response.text()) as unknown as T;
    }
    const text = await response.text();
    if (!text) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error("Response was not valid JSON");
    }
  },
};

export async function request<T>(input: RequestInfo | URL, options: RequestOptions = {}): Promise<RequestSuccess<T>> {
  const requestId = createRequestId();
  const parseJson = options.parseJson ?? true;
  const method = (options.method ?? "GET").toUpperCase();
  const autoToast = options.meta?.skipGlobalErrorToast ? false : method !== "GET";

  const headers = new Headers(options.headers ?? {});
  if (!headers.has("x-request-id")) {
    headers.set("x-request-id", requestId);
  }
  const init: RequestInit = { ...options, headers };

  let response: Response | undefined;
  const startedAt = new Date();

  try {
    if (typeof input === "string" && input.startsWith("/api/")) {
      // Mocked API endpoints for the demo environment. These intentionally
      // fail to illustrate error handling flows and produce traceable IDs.
      await delay(450);
      throw new RequestError("Upstream service is temporarily unavailable", {
        requestId,
        status: 503,
        url: input.toString(),
      });
    }

    response = await fetch(input, init);
    if (!response.ok) {
      throw new RequestError(`Request failed with status ${response.status}`, {
        requestId,
        status: response.status,
        url: input.toString(),
      });
    }

    const data = await HELPERS.parseResponse<T>(response, parseJson);

    emitRequestTrace({
      requestId,
      url: input.toString(),
      method,
      status: response.status,
      success: true,
      timestamp: startedAt.toISOString(),
      label: options.meta?.label,
      autoToast,
    });

    return { data, requestId, response };
  } catch (error) {
    const requestError = toRequestError(error, "Network request failed", {
      requestId,
      status: response?.status,
      url: input.toString(),
    });

    emitRequestTrace({
      requestId,
      url: input.toString(),
      method,
      status: requestError.status,
      success: false,
      timestamp: startedAt.toISOString(),
      errorMessage: requestError.message,
      label: options.meta?.label,
      autoToast,
    });

    throw requestError;
  }
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
