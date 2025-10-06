import type { Request, Response } from "express";
import { Pool } from "pg";
import { detectFormat, parseBankStatement, StatementFormat } from "../bankFeed/parser";
import { normalizeReference } from "../bankFeed/util";
import { findSettlementMatch, replayDlqMatches } from "../bankFeed/matcher";

const pool = new Pool();

function parseFormat(value: any): StatementFormat | undefined {
  if (!value) return undefined;
  const str = String(value).toLowerCase();
  if (str === "csv" || str === "ofx" || str === "json") return str;
  return undefined;
}

async function replayDlq(res: Response) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await replayDlqMatches(client);
    await client.query("COMMIT");
    return res.json({ replayed: result.scanned, matched: result.matched });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err?.message || String(err) });
  } finally {
    client.release();
  }
}

export async function ingestBankStatement(req: Request, res: Response) {
  const wantsReplay = String(req.query.replay ?? req.body?.replay ?? "").toLowerCase() === "true";
  if (wantsReplay) {
    return replayDlq(res);
  }

  const { data, format, source } = req.body || {};
  if (!data) {
    return res.status(400).json({ error: "Missing data" });
  }

  const fmt = parseFormat(format) ?? detectFormat(data, format);
  let lines: ReturnType<typeof parseBankStatement>;
  try {
    lines = parseBankStatement(data, fmt);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || "Parse failed" });
  }
  if (!lines.length) {
    return res.status(400).json({ error: "NO_LINES" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const statement = await client.query<{ id: number }>(
      "insert into bank_statements(source, format) values ($1,$2) returning id",
      [source ? String(source) : "upload", fmt.toUpperCase()]
    );
    const statementId = statement.rows[0].id;
    let matched = 0;
    let dlq = 0;

    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const isoDate = line.valueDate;
      const settlementId = await findSettlementMatch(client, line.amountCents, isoDate, line.reference);
      const status = settlementId ? "MATCHED" : "DLQ";
      await client.query(
        `insert into bank_lines(statement_id,line_no,value_date,amount_cents,reference,reference_normalized,raw,status,settlement_id,dlq_reason)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          statementId,
          idx + 1,
          isoDate,
          Math.abs(line.amountCents),
          line.reference,
          normalizeReference(line.reference),
          line.raw ?? {},
          status,
          settlementId,
          settlementId ? null : "NO_MATCH"
        ]
      );
      if (settlementId) {
        matched += 1;
        await client.query(
          "update settlements set status='MATCHED', matched_at=now() where id=$1",
          [settlementId]
        );
      } else {
        dlq += 1;
      }
    }

    await client.query("COMMIT");
    return res.json({ statement_id: statementId, ingested: lines.length, matched, dlq });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err?.message || String(err) });
  } finally {
    client.release();
  }
}
