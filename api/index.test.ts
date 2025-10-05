import { once } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

if (!process.env.RPT_PUBLIC_BASE64 && !process.env.ED25519_PUBLIC_KEY_PEM) {
  process.env.RPT_PUBLIC_BASE64 = Buffer.alloc(32).toString("base64");
}

test("payments api server boots", async () => {
  const { createApp } = await import("./index");
  const app = createApp();
  const server = app.listen(0);
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address === "object" && address.port > 0);

  server.close();
  await once(server, "close");
});
