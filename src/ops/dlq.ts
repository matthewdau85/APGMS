import { Pool } from "pg";
import { performRailRelease, RailReleasePayload } from "../rails/release";
import { ingestSettlement } from "../settlement/process";
import { recordActivity } from "./activity";

const pool = new Pool();

export type DlqSource = "rail_release" | "settlement_webhook";

function normaliseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

export async function enqueueDlq(source: DlqSource, payload: any, error: unknown) {
  const message = normaliseError(error);
  await pool.query(
    "insert into ops_dlq(source,payload,error,last_error) values ($1,$2,$3,$4)",
    [source, payload, message, message]
  );
}

export async function replayDlq(id: number) {
  const { rows } = await pool.query("select * from ops_dlq where id=$1", [id]);
  if (rows.length === 0) {
    throw new Error("DLQ_NOT_FOUND");
  }
  const entry = rows[0];
  try {
    let result: any;
    if (entry.source === "rail_release") {
      const payload = entry.payload as RailReleasePayload;
      result = await performRailRelease(payload);
      await recordActivity("ops", "release_attempt", "SUCCESS", {
        ...payload,
        via: "DLQ_REPLAY",
        dlq_id: id
      });
    } else if (entry.source === "settlement_webhook") {
      const payload = entry.payload as { csv: string };
      const ingest = ingestSettlement(payload?.csv ?? "");
      result = { ingested: ingest.ingested };
      await recordActivity("ops", "recon_import", "SUCCESS", {
        rows: ingest.ingested,
        via: "DLQ_REPLAY",
        dlq_id: id
      });
    } else {
      throw new Error(`UNKNOWN_DLQ_SOURCE:${entry.source}`);
    }
    await pool.query(
      "update ops_dlq set replayed_at=now(), replay_count=replay_count+1, last_error=null where id=$1",
      [id]
    );
    return { replayed: true, result };
  } catch (err) {
    const message = normaliseError(err);
    if (entry.source === "rail_release") {
      const payload = entry.payload as RailReleasePayload;
      await recordActivity("ops", "release_attempt", "FAILED", {
        ...payload,
        via: "DLQ_REPLAY",
        dlq_id: id,
        error: message
      });
    } else if (entry.source === "settlement_webhook") {
      await recordActivity("ops", "recon_import", "FAILED", {
        via: "DLQ_REPLAY",
        dlq_id: id,
        error: message
      });
    }
    await pool.query(
      "update ops_dlq set replay_count=replay_count+1, last_error=$2 where id=$1",
      [id, message]
    );
    throw err;
  }
}
