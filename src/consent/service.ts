import { Pool } from "pg";
import { HttpError } from "../http/error";

export type ConsentAcceptance = {
  acceptedAt: Date;
  acceptedBy: string;
};

const pool = new Pool();
let tableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rails_consent (
      id SERIAL PRIMARY KEY,
      accepted_by TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  tableEnsured = true;
}

export async function recordConsent(acceptedBy: string): Promise<ConsentAcceptance> {
  if (!acceptedBy || !acceptedBy.trim()) {
    throw new HttpError(400, "InvalidConsent", "acceptedBy is required");
  }
  await ensureTable();
  const { rows } = await pool.query(
    "INSERT INTO rails_consent (accepted_by) VALUES ($1) RETURNING accepted_by, accepted_at",
    [acceptedBy.trim()]
  );
  return {
    acceptedBy: rows[0].accepted_by,
    acceptedAt: new Date(rows[0].accepted_at),
  };
}

export async function latestConsent(): Promise<ConsentAcceptance | null> {
  await ensureTable();
  const { rows } = await pool.query(
    "SELECT accepted_by, accepted_at FROM rails_consent ORDER BY accepted_at DESC LIMIT 1"
  );
  if (!rows.length) return null;
  return {
    acceptedBy: rows[0].accepted_by,
    acceptedAt: new Date(rows[0].accepted_at),
  };
}

export class ConsentRequiredError extends HttpError {
  constructor(detail = "Explicit consent is required before enabling live rails.") {
    super(412, "ConsentRequired", detail);
  }
}

export async function requireConsent(): Promise<ConsentAcceptance> {
  const consent = await latestConsent();
  if (!consent) {
    throw new ConsentRequiredError();
  }
  return consent;
}
