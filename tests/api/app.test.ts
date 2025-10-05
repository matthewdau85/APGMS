import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

type SupertestFactory = typeof import("../helpers/supertest").default;
type ApiModule = typeof import("../../api/index");

let request: SupertestFactory;
let app: ApiModule["app"];

before(async () => {
  process.env.NODE_ENV = "test";
  try {
    request = (await import("supertest")).default as SupertestFactory;
  } catch {
    request = (await import("../helpers/supertest")).default;
  }
  ({ app } = await import("../../api/index"));
});

describe("api health", () => {
  it("returns 200 with ok payload", async () => {
    const response = await request(app).get("/health").expect(200);
    assert.equal((response.body as { ok?: boolean }).ok, true);
  });

  it("returns 404 for unknown routes", async () => {
    await request(app).get("/nope").expect(404);
  });
});
