import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import type { Server } from "http";
import { ReconState, assertCanTransition, canTransition } from "../../src/recon/stateMachine";

function startApp(): Promise<Server & { url: string }> {
  const app = express();
  app.use(express.json());

  app.post("/transition", (req, res) => {
    const { from, to } = req.body as { from: ReconState; to: ReconState };
    try {
      assertCanTransition(from, to);
      // In a valid case the DB update would succeed; we mirror state in response.
      res.json({ state: to });
    } catch (err) {
      const error = err as Error & { code?: string };
      if (!error.code) {
        // Simulate the trigger raising a Postgres error for parity with the DB guard.
        error.code = "P0001";
      }
      res.status(409).json({ error: error.message, code: error.code });
    }
  });

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const url = `http://127.0.0.1:${address.port}`;
        resolve(Object.assign(server, { url }));
      }
    });
  });
}

test("invalid transitions are rejected by the guard helpers", () => {
  assert.equal(canTransition(ReconState.OPEN, ReconState.RECONCILING), true);
  assert.equal(canTransition(ReconState.OPEN, ReconState.RELEASED), false);
  assert.throws(() => assertCanTransition(ReconState.OPEN, ReconState.RELEASED), {
    message: "Illegal recon state transition: OPEN -> RELEASED",
  });
});

test("API emits 409 with trigger error text when transition is illegal", async (t) => {
  const server = await startApp();
  t.after(() => server.close());

  const res = await fetch(`${server.url}/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: ReconState.OPEN, to: ReconState.RELEASED }),
  });

  assert.equal(res.status, 409);
  const payload = (await res.json()) as { error: string; code: string };
  assert.equal(payload.code, "P0001");
  assert.equal(payload.error, "Illegal recon state transition: OPEN -> RELEASED");
});
