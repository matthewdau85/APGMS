import assert from "node:assert";
import { isAnomalous } from "../src/domain/anomaly";

const CLEAR_CASE = isAnomalous(10_000, 10_020);
assert.strictEqual(CLEAR_CASE, "CLEAR", "Expected CLEAR classification");

const NEAR_CASE = isAnomalous(10_600, 10_000);
assert.strictEqual(NEAR_CASE, "NEAR", "Expected NEAR classification");

const BLOCK_CASE = isAnomalous(11_500, 10_000);
assert.strictEqual(BLOCK_CASE, "BLOCK", "Expected BLOCK classification");

console.log("anomaly.test.ts: all assertions passed");

