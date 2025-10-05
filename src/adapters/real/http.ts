import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

type Agent = http.Agent | https.Agent;

type PostJsonResult = {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body?: any;
};

export function postJson(
  targetUrl: string,
  payload: unknown,
  agent?: Agent,
  timeoutMs = 10000
): Promise<PostJsonResult> {
  const url = new URL(targetUrl);
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? https : http;
  const data = JSON.stringify(payload ?? {});

  const options: https.RequestOptions = {
    method: "POST",
    agent,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(data).toString(),
    },
  };

  return new Promise((resolve, reject) => {
    const req = transport.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw) {
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers });
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: parsed });
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("REQUEST_TIMEOUT"));
    });

    req.write(data);
    req.end();
  });
}
