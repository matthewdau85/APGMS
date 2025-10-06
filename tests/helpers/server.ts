import express from "express";

import { setPool } from "../../src/db/pool";
import { posIngestRouter } from "../../src/ingest/pos";
import { stpIngestRouter } from "../../src/ingest/stp";
import { taxApi } from "../../src/tax/api";

type QueryResult = { rows: any[]; rowCount: number };

type PayloadRow = {
  event_id: string;
  abn: string;
  period?: string;
  period_id: string;
  payload: any;
  received_at: string;
};

class MemoryPool {
  private payrollEvents = new Map<string, PayloadRow>();
  private payrollDlq: any[] = [];
  private posEvents = new Map<string, PayloadRow>();
  private posDlq: any[] = [];

  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    const trimmed = sql.trim().toLowerCase();
    if (trimmed.startsWith("insert into payroll_events")) {
      const [eventId, abn, period, periodId, payload] = params;
      const row: PayloadRow = {
        event_id: eventId,
        abn,
        period,
        period_id: periodId,
        payload: typeof payload === "string" ? JSON.parse(payload) : payload,
        received_at: new Date().toISOString(),
      };
      this.payrollEvents.set(eventId, row);
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("insert into payroll_dlq")) {
      const [reason, raw] = params;
      this.payrollDlq.push({ reason, raw_payload: typeof raw === "string" ? JSON.parse(raw) : raw });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("insert into pos_events")) {
      const [eventId, abn, periodId, payload] = params;
      const row: PayloadRow = {
        event_id: eventId,
        abn,
        period_id: periodId,
        payload: typeof payload === "string" ? JSON.parse(payload) : payload,
        received_at: new Date().toISOString(),
      };
      this.posEvents.set(eventId, row);
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("insert into pos_dlq")) {
      const [reason, raw] = params;
      this.posDlq.push({ reason, raw_payload: typeof raw === "string" ? JSON.parse(raw) : raw });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("select payload from payroll_events")) {
      const [abn, period, periodId] = params;
      const rows = Array.from(this.payrollEvents.values())
        .filter(row => row.abn === abn && row.period === period && row.period_id === periodId)
        .sort((a, b) => a.received_at.localeCompare(b.received_at))
        .map(row => ({ payload: row.payload }));
      return { rows, rowCount: rows.length };
    }

    if (trimmed.startsWith("select payload from pos_events")) {
      const [abn, periodId] = params;
      const rows = Array.from(this.posEvents.values())
        .filter(row => row.abn === abn && row.period_id === periodId)
        .sort((a, b) => a.received_at.localeCompare(b.received_at))
        .map(row => ({ payload: row.payload }));
      return { rows, rowCount: rows.length };
    }

    if (trimmed.startsWith("select * from payroll_dlq")) {
      return { rows: this.payrollDlq.map((raw, idx) => ({ id: idx + 1, ...raw })), rowCount: this.payrollDlq.length };
    }

    if (trimmed.startsWith("select * from pos_dlq")) {
      return { rows: this.posDlq.map((raw, idx) => ({ id: idx + 1, ...raw })), rowCount: this.posDlq.length };
    }

    if (trimmed.startsWith("select * from payroll_events")) {
      const rows = Array.from(this.payrollEvents.values()).map(row => ({
        event_id: row.event_id,
        abn: row.abn,
        period: row.period,
        period_id: row.period_id,
        payload: row.payload,
      }));
      return { rows, rowCount: rows.length };
    }

    if (trimmed.startsWith("select * from pos_events")) {
      const rows = Array.from(this.posEvents.values()).map(row => ({
        event_id: row.event_id,
        abn: row.abn,
        period_id: row.period_id,
        payload: row.payload,
      }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unsupported query: ${sql}`);
  }

  async connect() {
    return {
      query: (sql: string, params?: any[]) => this.query(sql, params),
      release: () => {},
    };
  }

  async end() {
    this.payrollEvents.clear();
    this.posEvents.clear();
    this.payrollDlq = [];
    this.posDlq = [];
  }
}

export async function createTestServer() {
  const pool = new MemoryPool();
  setPool(pool as unknown as any);

  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    })
  );
  app.use("/ingest/stp", stpIngestRouter);
  app.use("/ingest/pos", posIngestRouter);
  app.use("/tax", taxApi);

  return { app, pool };
}

export async function destroyTestServer(pool: MemoryPool) {
  await pool.end();
  setPool(null);
}
