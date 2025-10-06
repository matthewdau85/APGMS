-- Migration: ML advisory logging scaffold
CREATE TABLE IF NOT EXISTS ml_decisions (
    id SERIAL PRIMARY KEY,
    endpoint TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    user_decision TEXT NOT NULL CHECK (user_decision IN ('accept', 'override')),
    decided_by TEXT NOT NULL DEFAULT 'operator',
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_ml_decisions_request_hash ON ml_decisions(request_hash);
