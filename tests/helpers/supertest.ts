import type { Express } from "express";
import type { Server } from "http";
import { once } from "events";
import { AddressInfo } from "net";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type Headers = Record<string, string>;

export interface TestResponse {
  status: number;
  headers: Headers;
  text: string;
  body: unknown;
}

class RequestBuilder {
  private payload: unknown;
  private headers: Headers = {};

  constructor(private readonly app: Express, private readonly method: HttpMethod, private readonly path: string) {}

  send(body: unknown) {
    this.payload = body;
    return this;
  }

  set(header: string, value: string) {
    this.headers[header.toLowerCase()] = value;
    return this;
  }

  expect(status: number, body?: unknown): Promise<TestResponse> {
    return this.execute().then((response) => {
      if (response.status !== status) {
        throw new Error(`Expected status ${status} but received ${response.status}`);
      }
      if (body !== undefined) {
        const actual = JSON.stringify(response.body);
        const expected = JSON.stringify(body);
        if (actual !== expected) {
          throw new Error(`Expected body ${expected} but received ${actual}`);
        }
      }
      return response;
    });
  }

  private async execute(): Promise<TestResponse> {
    const server = await this.startServer();
    try {
      const address = server.address() as AddressInfo;
      const url = new URL(this.path, `http://127.0.0.1:${address.port}`);
      const headers = { ...this.headers };
      const options: RequestInit = { method: this.method.toUpperCase(), headers };

      if (this.payload !== undefined) {
        if (typeof this.payload === "string" || this.payload instanceof ArrayBuffer) {
          options.body = this.payload as BodyInit;
        } else {
          headers["content-type"] ??= "application/json";
          options.body = JSON.stringify(this.payload);
        }
      }

      const res = await fetch(url, options);
      const text = await res.text();
      const lowerHeaders = Object.fromEntries(Array.from(res.headers.entries()).map(([k, v]) => [k.toLowerCase(), v]));
      let parsed: unknown = text;
      const contentType = lowerHeaders["content-type"];
      if (contentType?.includes("application/json")) {
        try {
          parsed = text ? JSON.parse(text) : undefined;
        } catch {
          parsed = text;
        }
      }

      return {
        status: res.status,
        headers: lowerHeaders,
        text,
        body: parsed,
      };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private async startServer(): Promise<Server> {
    const server = this.app.listen(0);
    await once(server, "listening");
    return server;
  }
}

export default function request(app: Express) {
  const build = (method: HttpMethod) => (path: string) => new RequestBuilder(app, method, path);

  return {
    get: build("get"),
    post: build("post"),
    put: build("put"),
    patch: build("patch"),
    delete: build("delete"),
  };
}
