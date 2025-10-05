CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_sub TEXT NOT NULL,
    action TEXT NOT NULL,
    target_url TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    event_payload JSONB NOT NULL,
    prev_hash TEXT,
    event_hash TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at);
