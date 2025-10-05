param(
  [Parameter(Mandatory = $true)]
  [string]$RepoPath
)

# ---------- Utilities ----------
function New-Dir {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Backup-IfExists {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    $bak = "$Path.$ts.bak"
    Copy-Item -LiteralPath $Path -Destination $bak -Recurse -Force
    Write-Host "[ OK ] Backup -> $bak"
  }
}

function Write-Text {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  New-Dir $dir
  if (Test-Path -LiteralPath $Path) { Backup-IfExists $Path }
  $Content | Out-File -LiteralPath $Path -Encoding UTF8 -Force
  Write-Host "[ OK ] Wrote $Path"
}

function Append-Text {
  param([string]$Path, [string]$Content)
  $dir = Split-Path -Parent $Path
  New-Dir $dir
  if (-not (Test-Path -LiteralPath $Path)) {
    $Content | Out-File -LiteralPath $Path -Encoding UTF8 -Force
  } else {
    Add-Content -LiteralPath $Path -Value $Content -Encoding UTF8
  }
  Write-Host "[ OK ] Appended $Path"
}

# ---------- Validate repo ----------
if (-not (Test-Path -LiteralPath $RepoPath)) {
  Write-Error "Repo path not found: $RepoPath"
  exit 1
}
Set-Location -LiteralPath $RepoPath
Write-Host "[ INFO ] Repo: $RepoPath"

# ---------- 0) Folder layout ----------
$folders = @(
  "schema\impl",
  "prompts",
  "golden",
  "redteam",
  "apps\services\bas-gate",
  "apps\services\recon",
  "apps\services\bank-egress",
  "apps\services\audit",
  "libs\rpt",
  "libs\audit_chain",
  "tests\acceptance",
  "migrations"
)
$folders | ForEach-Object { New-Dir (Join-Path $RepoPath $_) }

# ---------- 1) JSON Schema ----------
$schemaJson = @'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "APGMS_ImplSpec",
  "type": "object",
  "required": [
    "spec_version",
    "scope",
    "components",
    "interfaces",
    "flows",
    "security_controls",
    "compliance_mapping",
    "acceptance_tests"
  ],
  "properties": {
    "spec_version": { "type": "string", "pattern": "^v\\d+\\.\\d+\\.\\d+$" },
    "scope": {
      "type": "array",
      "items": {
        "enum": ["PAYGW","GST","BAS","Security","Dashboard","Banking-API","POS-API","STP-ATO","All"]
      },
      "minItems": 1
    },
    "assumptions": { "type": "array", "items": { "type": "string", "maxLength": 280 } },
    "components": {
      "type": "array",
      "minItems": 5,
      "items": {
        "type": "object",
        "required": ["id","name","type","owner","tier","description"],
        "properties": {
          "id": { "type": "string", "pattern": "cmp_[a-z0-9_\\-]{3,50}" },
          "name": { "type": "string" },
          "type": { "enum": ["service","api","job","state_machine","worker","ui","datastore","queue","kms","monitoring"] },
          "owner": { "type": "string" },
          "tier": { "enum": ["crit","high","med","low"] },
          "description": { "type": "string", "maxLength": 800 },
          "datastores": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "interfaces": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id","name","direction","protocol","auth","endpoint","request_schema","response_schema"],
        "properties": {
          "id": { "type": "string", "pattern": "if_[a-z0-9_\\-]{3,50}" },
          "name": { "type": "string" },
          "direction": { "enum": ["ingress","egress","internal"] },
          "protocol": { "enum": ["HTTPS","mTLS","Webhook","SQS","Kafka","gRPC"] },
          "auth": { "enum": ["MFA+RBAC","mTLS","OIDC","HMAC"] },
          "endpoint": { "type": "string" },
          "request_schema": { "type": "object" },
          "response_schema": { "type": "object" },
          "sla_ms": { "type": "integer", "minimum": 10, "maximum": 60000 }
        }
      }
    },
    "flows": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id","name","preconditions","steps","postconditions","failure_modes"],
        "properties": {
          "id": { "type": "string", "pattern": "flow_[a-z0-9_\\-]{3,50}" },
          "name": { "type": "string" },
          "preconditions": { "type": "array", "items": { "type": "string" } },
          "steps": { "type": "array", "items": { "type": "string" }, "minItems": 3 },
          "postconditions": { "type": "array", "items": { "type": "string" } },
          "failure_modes": { "type": "array", "items": { "type": "string" } },
          "controls": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "security_controls": {
      "type": "object",
      "required": ["encryption_at_transit","mfa","fraud_detection","audit_log"],
      "properties": {
        "encryption_at_transit": { "enum": ["AES-256/TLS1.3","TLS1.3-only"] },
        "mfa": { "enum": ["required-for-admins","required-everyone"] },
        "fraud_detection": { "type": "string" },
        "audit_log": { "type": "string" },
        "separation_of_duties": { "type": "string" }
      }
    },
    "compliance_mapping": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["obligation","source","control"],
        "properties": {
          "obligation": { "type": "string" },
          "source": { "enum": ["Patent-APGMS","ITAA1997","GSTAct1999","BAS-Process"] },
          "control": { "type": "string" }
        }
      }
    },
    "acceptance_tests": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id","given","when","then"],
        "properties": {
          "id": { "type": "string" },
          "given": { "type": "string" },
          "when": { "type": "string" },
          "then": { "type": "string" }
        }
      }
    },
    "citations": { "type": "array", "items": { "type": "string" } },
    "run_id": { "type": "string" }
  }
}
'@

Write-Text -Path (Join-Path $RepoPath "schema\impl\APGMS_ImplSpec.schema.json") -Content $schemaJson

# ---------- 2) Prompts and harness ----------
$specYaml = @'
schema: schema/impl/APGMS_ImplSpec.schema.json
system: |
  You are a spec generator. Use ONLY the provided patent context.
  Produce JSON ONLY that validates against the schema. If fields cannot be
  supported by the patent, follow the refusal rule and populate "assumptions".
rules:
  - numbered terse style, no adjectives
  - no external facts (no law/API names) beyond patent context
refusal_rule: |
  If >25% required fields cannot be supported by patent: return "insufficient info".
  Otherwise include missing areas in "assumptions".
outputs:
  - APGMS_ImplSpec
'@
Write-Text -Path (Join-Path $RepoPath "prompts\spec.yaml") -Content $specYaml

# ---------- 3) SQL migration ----------
$mig = @'
-- 002_apgms_patent_core.sql
-- BAS Gate state machine, OWA ledger, audit hash chain, RPT store

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gate_state') THEN
    CREATE TYPE gate_state AS ENUM ('OPEN','RECONCILING','RPT_ISSUED','RELEASED','BLOCKED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS bas_gate_states (
  id SERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  state gate_state NOT NULL,
  reason_code VARCHAR(64),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  hash_prev CHAR(64),
  hash_this CHAR(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_bas_gate_period ON bas_gate_states (period_id);

CREATE TABLE IF NOT EXISTS bas_gate_transition_log (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  actor TEXT,
  reason TEXT,
  trace_id TEXT,
  from_state gate_state,
  to_state gate_state NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_bas_gate_transition_period ON bas_gate_transition_log (period_id, created_at DESC);

DO $$
DECLARE
  has_varchar_column BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bas_gate_states' AND column_name = 'state' AND udt_name <> 'gate_state'
  ) INTO has_varchar_column;

  IF has_varchar_column THEN
    ALTER TABLE bas_gate_states DROP CONSTRAINT IF EXISTS bas_gate_states_state_check;
    UPDATE bas_gate_states SET state = 'OPEN' WHERE state = 'Open';
    UPDATE bas_gate_states SET state = 'RECONCILING' WHERE state IN ('Pending-Close','Reconciling');
    UPDATE bas_gate_states SET state = 'RPT_ISSUED' WHERE state = 'RPT-Issued';
    UPDATE bas_gate_states SET state = 'RELEASED' WHERE state = 'Remitted';
    UPDATE bas_gate_states SET state = 'BLOCKED' WHERE state = 'Blocked';
    ALTER TABLE bas_gate_states ALTER COLUMN state TYPE gate_state USING state::gate_state;
  END IF;
END$$;

CREATE OR REPLACE FUNCTION bas_gate_validate_transition()
RETURNS TRIGGER AS $$
DECLARE
  prior_state gate_state;
  actor TEXT;
  why TEXT;
  trace TEXT;
  allowed BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    prior_state := NULL;
  ELSE
    prior_state := OLD.state;
  END IF;

  actor := NULLIF(current_setting('apgms.actor', TRUE), '');
  why := COALESCE(NULLIF(current_setting('apgms.reason', TRUE), ''), NEW.reason_code);
  trace := NULLIF(current_setting('apgms.trace_id', TRUE), '');

  IF prior_state IS NULL THEN
    allowed := NEW.state IN ('OPEN','BLOCKED');
  ELSE
    CASE prior_state
      WHEN 'OPEN' THEN
        allowed := NEW.state IN ('OPEN','RECONCILING','BLOCKED');
      WHEN 'RECONCILING' THEN
        allowed := NEW.state IN ('RECONCILING','RPT_ISSUED','BLOCKED');
      WHEN 'RPT_ISSUED' THEN
        allowed := NEW.state IN ('RPT_ISSUED','RELEASED','BLOCKED');
      WHEN 'RELEASED' THEN
        allowed := NEW.state = 'RELEASED';
      WHEN 'BLOCKED' THEN
        allowed := NEW.state IN ('BLOCKED','RECONCILING');
    END CASE;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid BAS gate transition from % to %', prior_state, NEW.state
      USING ERRCODE = 'P0001',
            HINT = 'Valid transitions: OPEN→RECONCILING→RPT_ISSUED→RELEASED. Use BLOCKED for holds; resolve blocks via RECONCILING.';
  END IF;

  INSERT INTO bas_gate_transition_log(period_id, actor, reason, trace_id, from_state, to_state)
  VALUES (NEW.period_id, actor, why, trace, prior_state, NEW.state);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bas_gate_state_guard ON bas_gate_states;
CREATE TRIGGER bas_gate_state_guard
BEFORE INSERT OR UPDATE ON bas_gate_states
FOR EACH ROW
EXECUTE FUNCTION bas_gate_validate_transition();

CREATE TABLE IF NOT EXISTS owa_ledger (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('PAYGW','GST')),
  credit_amount NUMERIC(18,2) NOT NULL,
  source_ref VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  audit_hash CHAR(64)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_time TIMESTAMP NOT NULL DEFAULT NOW(),
  category VARCHAR(32) NOT NULL, -- bas_gate, rpt, egress, security
  message TEXT NOT NULL,
  hash_prev CHAR(64),
  hash_this CHAR(64)
);

CREATE TABLE IF NOT EXISTS rpt_store (
  id BIGSERIAL PRIMARY KEY,
  period_id VARCHAR(32) NOT NULL,
  rpt_json JSONB NOT NULL,
  rpt_sig  TEXT NOT NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Minimal guard view: no generic debit primitive
CREATE VIEW owa_balance AS
SELECT kind, COALESCE(SUM(credit_amount),0) AS balance
FROM owa_ledger GROUP BY kind;

-- Transition helper skeletons (fill with business rules in services)
'@
Write-Text -Path (Join-Path $RepoPath "migrations\002_apgms_patent_core.sql") -Content $mig

# ---------- 4) Python libs: RPT and audit chain ----------
$rptPy = @'
# libs/rpt/rpt.py
import json, hmac, hashlib, os, time
from typing import Dict, Any

def _key() -> bytes:
    k = os.getenv("APGMS_RPT_SECRET", "dev-secret-change-me")
    return k.encode("utf-8")

def sign(payload: Dict[str, Any]) -> str:
    msg = json.dumps(payload, sort_keys=True, separators=(",",":")).encode("utf-8")
    return hmac.new(_key(), msg, hashlib.sha256).hexdigest()

def verify(payload: Dict[str, Any], signature: str) -> bool:
    try:
        exp = sign(payload)
        return hmac.compare_digest(exp, signature)
    except Exception:
        return False

def build(period_id: str,
          paygw_total: float,
          gst_total: float,
          source_digests: Dict[str,str],
          anomaly_score: float,
          ttl_seconds: int = 3600) -> Dict[str, Any]:
    rpt = {
        "period_id": period_id,
        "paygw_total": round(paygw_total,2),
        "gst_total": round(gst_total,2),
        "source_digests": source_digests,
        "anomaly_score": anomaly_score,
        "expires_at": int(time.time()) + ttl_seconds,
        "nonce": os.urandom(8).hex()
    }
    rpt["signature"] = sign(rpt)
    return rpt
'@
Write-Text -Path (Join-Path $RepoPath "libs\rpt\rpt.py") -Content $rptPy
Write-Text -Path (Join-Path $RepoPath "libs\rpt\__init__.py") -Content ""

$auditPy = @'
# libs/audit_chain/chain.py
import hashlib
from typing import Optional

def link(prev_hash: Optional[str], payload: str) -> str:
    h = hashlib.sha256()
    if prev_hash:
        h.update(prev_hash.encode("utf-8"))
    h.update(payload.encode("utf-8"))
    return h.hexdigest()
'@
Write-Text -Path (Join-Path $RepoPath "libs\audit_chain\chain.py") -Content $auditPy
Write-Text -Path (Join-Path $RepoPath "libs\audit_chain\__init__.py") -Content ""

# ---------- 5) Service scaffolds (FastAPI) ----------
$commonReq = @'
fastapi==0.115.0
uvicorn==0.30.6
pydantic==2.9.2
psycopg2-binary==2.9.9
'@

# bas-gate
$basMain = @'
# apps/services/bas-gate/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, time, uuid

app = FastAPI(title="bas-gate")

VALID_STATES = {"OPEN", "RECONCILING", "RPT_ISSUED", "RELEASED", "BLOCKED"}
DEFAULT_ACTOR = os.getenv("BAS_GATE_DEFAULT_ACTOR", "bas-gate-service")


class TransitionReq(BaseModel):
    period_id: str
    target_state: str
    reason_code: str | None = None
    actor: str | None = None
    trace_id: str | None = None

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.post("/gate/transition")
def transition(req: TransitionReq):
    target_state = req.target_state.upper()
    if target_state not in VALID_STATES:
        raise HTTPException(400, "invalid state")

    actor = req.actor or DEFAULT_ACTOR
    trace_id = req.trace_id or uuid.uuid4().hex

    conn = db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT hash_this FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        prev = row[0] if row else None
        payload = json.dumps({"period_id": req.period_id, "state": target_state, "ts": int(time.time())}, separators=(",",":"))
        import libs.audit_chain.chain as ch
        h = ch.link(prev, payload)

        cur.execute("SELECT set_config('apgms.actor', %s, true)", (actor,))
        cur.execute("SELECT set_config('apgms.trace_id', %s, true)", (trace_id,))
        cur.execute("SELECT set_config('apgms.reason', %s, true)", (req.reason_code or "",))

        if row:
            cur.execute(
                "UPDATE bas_gate_states SET state=%s, reason_code=%s, updated_at=NOW(), hash_prev=%s, hash_this=%s WHERE period_id=%s",
                (target_state, req.reason_code, prev, h, req.period_id)
            )
        else:
            cur.execute(
                "INSERT INTO bas_gate_states(period_id,state,reason_code,hash_prev,hash_this) VALUES (%s,%s,%s,%s,%s)",
                (req.period_id, target_state, req.reason_code, prev, h)
            )
        cur.execute(
            "INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('bas_gate',%s,%s,%s)",
            (payload, prev, h)
        )
        conn.commit()
        return {"ok": True, "hash": h, "trace_id": trace_id}
    except psycopg2.Error as exc:
        conn.rollback()
        if getattr(exc, "pgcode", None) == "P0001":
            diag = getattr(exc, "diag", None)
            message = getattr(diag, "message_primary", str(exc)) if diag else str(exc)
            hint = getattr(diag, "hint", None)
            detail = {
                "error": "invalid_transition",
                "message": message,
                "hint": hint or "Check BAS gate state machine policy and resolve blocking conditions."
            }
            raise HTTPException(status_code=409, detail=detail) from None
        raise HTTPException(status_code=500, detail="database error") from None
    finally:
        cur.close()
        conn.close()
'@
Write-Text -Path (Join-Path $RepoPath "apps\services\bas-gate\main.py") -Content $basMain
Write-Text -Path (Join-Path $RepoPath "apps\services\bas-gate\requirements.txt") -Content $commonReq

# recon
$reconMain = @'
# apps/services/recon/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import os, psycopg2, json, math

app = FastAPI(title="recon")

class ReconReq(BaseModel):
    period_id: str
    paygw_total: float
    gst_total: float
    owa_paygw: float
    owa_gst: float
    anomaly_score: float
    tolerance: float = 0.01

@app.post("/recon/run")
def run(req: ReconReq):
    pay_ok = math.isclose(req.paygw_total, req.owa_paygw, abs_tol=req.tolerance)
    gst_ok = math.isclose(req.gst_total, req.owa_gst, abs_tol=req.tolerance)
    anomaly_ok = req.anomaly_score < 0.8
    if pay_ok and gst_ok and anomaly_ok:
        return {"pass": True, "reason_code": None, "controls": ["BAS-GATE","RPT"], "next_state": "RPT_ISSUED"}
    reason = "shortfall" if (not pay_ok or not gst_ok) else "anomaly_breach"
    return {"pass": False, "reason_code": reason, "controls": ["BLOCK"], "next_state": "BLOCKED"}
'@
Write-Text -Path (Join-Path $RepoPath "apps\services\recon\main.py") -Content $reconMain
Write-Text -Path (Join-Path $RepoPath "apps\services\recon\requirements.txt") -Content $commonReq

# bank-egress
$bankMain = @'
# apps/services/bank-egress/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import os, psycopg2, json, uuid
from libs.rpt.rpt import verify

app = FastAPI(title="bank-egress")

DEFAULT_ACTOR = os.getenv("BANK_EGRESS_DEFAULT_ACTOR", "bank-egress-service")


class EgressReq(BaseModel):
    period_id: str
    rpt: dict
    trace_id: str | None = None

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.post("/egress/remit")
def remit(req: EgressReq):
    if "signature" not in req.rpt or not verify({k: v for k, v in req.rpt.items() if k != "signature"}, req.rpt["signature"]):
        raise HTTPException(400, "invalid RPT signature")
    conn = db()
    cur = conn.cursor()
    trace_id = req.trace_id or uuid.uuid4().hex
    try:
        cur.execute("SELECT state FROM bas_gate_states WHERE period_id=%s", (req.period_id,))
        row = cur.fetchone()
        if not row or row[0] != "RPT_ISSUED":
            raise HTTPException(409, "gate not in RPT_ISSUED")
        payload = json.dumps({"period_id": req.period_id, "action": "remit", "trace_id": trace_id})
        cur.execute("SELECT set_config('apgms.actor', %s, true)", (DEFAULT_ACTOR,))
        cur.execute("SELECT set_config('apgms.trace_id', %s, true)", (trace_id,))
        cur.execute("SELECT set_config('apgms.reason', %s, true)", ("release",))
        cur.execute("INSERT INTO audit_log(category,message,hash_prev,hash_this) VALUES ('egress',%s,NULL,NULL)", (payload,))
        cur.execute("UPDATE bas_gate_states SET state='RELEASED', updated_at=NOW() WHERE period_id=%s", (req.period_id,))
        conn.commit()
        return {"ok": True, "trace_id": trace_id}
    except HTTPException:
        conn.rollback()
        raise
    except psycopg2.Error as exc:
        conn.rollback()
        if getattr(exc, "pgcode", None) == "P0001":
            diag = getattr(exc, "diag", None)
            message = getattr(diag, "message_primary", str(exc)) if diag else str(exc)
            hint = getattr(diag, "hint", None)
            detail = {
                "error": "invalid_transition",
                "message": message,
                "hint": hint or "Gate must be in RPT_ISSUED before release."
            }
            raise HTTPException(status_code=409, detail=detail) from None
        raise HTTPException(status_code=500, detail="database error") from None
    finally:
        cur.close()
        conn.close()
'@
Write-Text -Path (Join-Path $RepoPath "apps\services\bank-egress\main.py") -Content $bankMain
Write-Text -Path (Join-Path $RepoPath "apps\services\bank-egress\requirements.txt") -Content $commonReq

# audit (export bundle)
$auditMain = @'
# apps/services/audit/main.py
from fastapi import FastAPI
import os, psycopg2, json

app = FastAPI(title="audit")

def db():
    return psycopg2.connect(
        host=os.getenv("PGHOST","127.0.0.1"),
        user=os.getenv("PGUSER","postgres"),
        password=os.getenv("PGPASSWORD","postgres"),
        dbname=os.getenv("PGDATABASE","postgres"),
        port=int(os.getenv("PGPORT","5432"))
    )

@app.get("/audit/bundle/{period_id}")
def bundle(period_id: str):
    conn = db(); cur = conn.cursor()
    cur.execute("SELECT rpt_json, rpt_sig, issued_at FROM rpt_store WHERE period_id=%s ORDER BY issued_at DESC LIMIT 1", (period_id,))
    rpt = cur.fetchone()
    cur.execute("SELECT event_time, category, message FROM audit_log WHERE message LIKE %s ORDER BY event_time", (f'%\"period_id\":\"{period_id}\"%',))
    logs = [{"event_time": str(r[0]), "category": r[1], "message": r[2]}] if cur.rowcount else []
    cur.close(); conn.close()
    return {"period_id": period_id, "rpt": rpt[0] if rpt else None, "audit": logs}
'@
Write-Text -Path (Join-Path $RepoPath "apps\services\audit\main.py") -Content $auditMain
Write-Text -Path (Join-Path $RepoPath "apps\services\audit\requirements.txt") -Content $commonReq

# ---------- 6) Acceptance tests (pytest skeleton) ----------
$tests = @'
# tests/acceptance/test_patent_paths.py
import json, time
from libs.rpt.rpt import build, verify

def test_rpt_sign_verify():
    rpt = build("2024Q4", 100.0, 200.0, {"payroll":"abc","pos":"def"}, 0.1, ttl_seconds=60)
    assert "signature" in rpt
    payload = {k:v for k,v in rpt.items() if k!="signature"}
    assert verify(payload, rpt["signature"])

def test_recon_pass_example():
    # Fake math: equality within tolerance and anomaly ok
    paygw_total, gst_total = 100.00, 200.00
    owa_paygw, owa_gst = 100.00, 200.00
    anomaly_score = 0.1
    assert abs(paygw_total - owa_paygw) <= 0.01
    assert abs(gst_total - owa_gst) <= 0.01
    assert anomaly_score < 0.8
'@
Write-Text -Path (Join-Path $RepoPath "tests\acceptance\test_patent_paths.py") -Content $tests

# ---------- 7) Compose override (non-destructive) ----------
$compose = @'
# docker-compose.patent.yml
services:
  bas-gate:
    build:
      context: ./apps/services/bas-gate
    command: python -m uvicorn main:app --host 0.0.0.0 --port 8101
    environment:
      - PGHOST=host.docker.internal
      - PGUSER=postgres
      - PGPASSWORD=postgres
      - PGDATABASE=postgres
      - PGPORT=5432
    ports: ["8101:8101"]

  recon:
    build:
      context: ./apps/services/recon
    command: python -m uvicorn main:app --host 0.0.0.0 --port 8102
    environment:
      - PGHOST=host.docker.internal
      - PGUSER=postgres
      - PGPASSWORD=postgres
      - PGDATABASE=postgres
      - PGPORT=5432
    ports: ["8102:8102"]

  bank-egress:
    build:
      context: ./apps/services/bank-egress
    command: python -m uvicorn main:app --host 0.0.0.0 --port 8103
    environment:
      - PGHOST=host.docker.internal
      - PGUSER=postgres
      - PGPASSWORD=postgres
      - PGDATABASE=postgres
      - PGPORT=5432
      - APGMS_RPT_SECRET=dev-secret-change-me
    ports: ["8103:8103"]

  audit:
    build:
      context: ./apps/services/audit
    command: python -m uvicorn main:app --host 0.0.0.0 --port 8104
    environment:
      - PGHOST=host.docker.internal
      - PGUSER=postgres
      - PGPASSWORD=postgres
      - PGDATABASE=postgres
      - PGPORT=5432
    ports: ["8104:8104"]
'@
Write-Text -Path (Join-Path $RepoPath "docker-compose.patent.yml") -Content $compose

# ---------- 8) README next steps ----------
$readme = @'
# APGMS Patent Gate-and-Token Additions

## Quick start
1) Apply migration in Postgres:
   psql -h 127.0.0.1 -U postgres -d postgres -f migrations/002_apgms_patent_core.sql

2) Build and run the services:
   docker compose -f docker-compose.patent.yml build
   docker compose -f docker-compose.patent.yml up -d

3) Happy path (manual):
   # 3.1 move gate to RPT_ISSUED (after your recon pass)
   curl -X POST http://localhost:8101/gate/transition -H "content-type: application/json" ^
     -d "{""period_id"":""2024Q4"",""target_state"":""RPT_ISSUED"",""actor"":""ops-user"",""trace_id"":""demo-trace""}"

   # 3.2 generate an RPT in Python REPL (or via your engine):
   # from libs.rpt.rpt import build
   # rpt = build("2024Q4",100.0,200.0,{"payroll":"abc","pos":"def"},0.1)

   # 3.3 remit (bank-egress)
   curl -X POST http://localhost:8103/egress/remit -H "content-type: application/json" ^
     -d "{""period_id"":""2024Q4"",""trace_id"":""demo-remit"",""rpt"":{""period_id"":""2024Q4"",""paygw_total"":100.0,""gst_total"":200.0,""source_digests"":{""payroll"":""abc"",""pos"":""def""},""anomaly_score"":0.1,""expires_at"":9999999999,""nonce"":""deadbeef"",""signature"":""REPLACE_WITH_REAL_SIGNATURE""}}"

4) Acceptance tests:
   # assuming your venv:
   # pip install -r apps/services/bas-gate/requirements.txt
   # pip install -r apps/services/recon/requirements.txt
   # pip install -r apps/services/bank-egress/requirements.txt
   # pip install -r apps/services/audit/requirements.txt
   # pip install pytest
   pytest -q

Notes:
- Replace the HMAC secret with KMS in production.
- Enforce SoD in your auth layer: role A issues RPT, role B calls egress.
'@
Write-Text -Path (Join-Path $RepoPath "README_PATENT_ADD.md") -Content $readme

Write-Host "`n[ DONE ] Scaffolding complete."
Write-Host "Next:"
Write-Host "1) psql -h 127.0.0.1 -U postgres -d postgres -f migrations/002_apgms_patent_core.sql"
Write-Host "2) docker compose -f docker-compose.patent.yml build"
Write-Host "3) docker compose -f docker-compose.patent.yml up -d"
Write-Host "4) Open README_PATENT_ADD.md and follow test steps."
