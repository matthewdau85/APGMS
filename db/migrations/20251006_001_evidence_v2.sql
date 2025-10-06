-- 20251006_001_evidence_v2.sql
ALTER TABLE evidence_bundles ADD COLUMN IF NOT EXISTS rules_manifest_sha256 TEXT;
ALTER TABLE evidence_bundles ADD COLUMN IF NOT EXISTS settlement JSONB;
ALTER TABLE evidence_bundles ADD COLUMN IF NOT EXISTS approvals JSONB;
ALTER TABLE evidence_bundles ADD COLUMN IF NOT EXISTS narrative TEXT;
ALTER TABLE evidence_bundles ADD COLUMN IF NOT EXISTS simulated BOOLEAN DEFAULT false;
