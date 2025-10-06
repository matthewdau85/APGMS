#!/usr/bin/env tsx
import { replayDeadLetters } from "../src/queues/releaseQueue";

const limit = Number(process.env.DLQ_REPLAY_LIMIT ?? 10);
const throttle = Number(process.env.DLQ_REPLAY_THROTTLE_MS ?? 200);

async function main() {
  const result = await replayDeadLetters(limit, throttle);
  if (result) {
    console.log("Replayed", result.transfer_uuid, "->", result.bank_receipt_hash);
  } else {
    console.log("No DLQ entries to replay");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("DLQ replay failed", err);
  process.exit(1);
});
