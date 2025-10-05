import type { Express } from "express";
import type { AddressInfo } from "net";

interface JsonLike {
  [key: string]: unknown;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Body = JsonLike | undefined;

type Response = {
  status: number;
  type: string;
  body: unknown;
};

type RequestExecutor = (path: string, body?: Body) => Promise<Response>;

type RequestBuilder = {
  get: RequestExecutor;
  post: RequestExecutor;
  put: RequestExecutor;
  patch: RequestExecutor;
  delete: RequestExecutor;
};

export default function request(app: Express): RequestBuilder {
  return {
    get: (path) => performRequest(app, "GET", path),
    post: (path, body) => performRequest(app, "POST", path, body),
    put: (path, body) => performRequest(app, "PUT", path, body),
    patch: (path, body) => performRequest(app, "PATCH", path, body),
    delete: (path, body) => performRequest(app, "DELETE", path, body),
  };
}

async function performRequest(
  app: Express,
  method: Method,
  path: string,
  body?: Body,
): Promise<Response> {
  const server = app.listen(0);
  try {
    const address = server.address() as AddressInfo;
    const target = new URL(path, `http://127.0.0.1:${address.port}`);

    const headers: Record<string, string> = {};
    let payload: string | undefined;

    if (body && method !== "GET") {
      payload = JSON.stringify(body);
      headers["content-type"] = "application/json";
    }

    const response = await fetch(target, {
      method,
      headers,
      body: payload,
    });

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const parsedBody = parseBody(text, contentType);

    return {
      status: response.status,
      type: contentType,
      body: parsedBody,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

function parseBody(text: string, contentType: string): unknown {
  if (!text) {
    return undefined;
  }

  if (contentType.startsWith("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}
