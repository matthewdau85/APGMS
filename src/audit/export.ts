const AUDIT_ALLOWLIST = ["seq", "created_at", "actor", "action", "terminal_hash"] as const;

type AllowedField = (typeof AUDIT_ALLOWLIST)[number];

export type AuditRow = Partial<Record<AllowedField, unknown>>;

export function sanitizeAuditRow(row: Record<string, unknown>): AuditRow {
  const sanitized: AuditRow = {};
  for (const key of AUDIT_ALLOWLIST) {
    if (key in row) {
      sanitized[key] = row[key];
    }
  }
  return sanitized;
}

export function sanitizeAuditRows(rows: Record<string, unknown>[]): AuditRow[] {
  return rows.map((row) => sanitizeAuditRow(row));
}
