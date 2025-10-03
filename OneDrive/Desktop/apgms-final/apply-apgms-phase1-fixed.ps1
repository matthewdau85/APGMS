param(
  [string]$RepoRoot = "C:\Users\matth\OneDrive\Desktop\apgms-final"
)
$ErrorActionPreference = 'Stop'

function W($RelPath, $Content) {
  $Full = Join-Path $RepoRoot $RelPath
  $Dir = Split-Path $Full -Parent
  if (!(Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
  Set-Content -Path $Full -Value $Content -Encoding UTF8
  Write-Host "Wrote $RelPath"
}

# --- Makefile (Windows-friendly) ---
$make = @"
.PHONY: bootstrap dev test lint typecheck compose-up seed e2e

bootstrap:
	@echo [bootstrap] Python venv + Poetry + deps
	@powershell -NoProfile -Command "if (!(Test-Path .venv)) { python -m venv .venv }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; python -m pip install -U pip; pip install poetry"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd apps\\services\\event-normalizer; poetry install"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd apps\\services\\tax-engine; poetry install"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd libs\\py-sdk; poetry install"
	@echo [bootstrap] Node/pnpm
	@powershell -NoProfile -Command "corepack enable; corepack prepare pnpm@latest --activate"
	@cd apps/web/console && pnpm install
	@echo [bootstrap] Generate TS/Py types from JSON Schemas
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; python libs/schemas/codegen/generate.py"
	@echo [bootstrap] Done

dev:
	@echo Use: docker compose up -d && open http://localhost:5173

test:
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd libs\\py-sdk; poetry run pytest -q"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; cd apps\\services\\tax-engine; poetry run pytest -q"

lint:
	@echo lint stubs

typecheck:
	@echo typecheck stubs

compose-up:
	@docker compose up -d --build
	@echo Services:
	@echo  - http://localhost:8001/healthz (normalizer)
	@echo  - http://localhost:8002/healthz (tax-engine)
	@echo  - http://localhost:3000 (Grafana admin/admin)

seed:
	@echo Seed stub (P96)

e2e:
	@echo E2E stub (P80)
"@
W "Makefile" $make

# --- libs/py-sdk (RPT + deps) ---
$pyproj = @"
[tool.poetry]
name = "apgms-py-sdk"
version = "0.1.0"
description = "APGMS Python SDK (schemas, RPT)"
authors = ["you"]
packages = [{ include = "apgms_sdk" }]

[tool.poetry.dependencies]
python = ">=3.11,<4.0"
pydantic = "^2.9.2"
PyNaCl = "^1.5.0"
cbor2 = "^5.6.5"

[tool.poetry.group.dev.dependencies]
pytest = "^8.3.3"
"@
W "libs/py-sdk/pyproject.toml" $pyproj
W "libs/py-sdk/apgms_sdk/__init__.py" ""

$rpt = @"
from __future__ import annotations
from typing import Optional, Dict
import base64, time, os
import nacl.signing
import cbor2

RPT_TAG = b"APGMS_RPT_v1"

def _now(): return int(time.time())

def issue_rpt(payload: dict, sk_bytes: bytes) -> str:
    signer = nacl.signing.SigningKey(sk_bytes)
    ordered_keys = [
        "entity_id","period_id","tax_type","amount_cents","merkle_root","running_balance_hash",
        "anomaly_vector","thresholds","rail_id","destination_id","expiry_ts","reference","nonce"
    ]
    ordered = [(k, payload[k]) for k in ordered_keys]
    msg = RPT_TAG + cbor2.dumps(ordered)
    sig = signer.sign(msg).signature
    tok = base64.urlsafe_b64encode(cbor2.dumps({
        "t": "rpt","v": 1, "p": cbor2.dumps(ordered),
        "s": bytes(signer.verify_key), "sig": sig
    })).decode("ascii").rstrip("=")
    return tok

def decode(token: str) -> dict:
    raw = base64.urlsafe_b64decode(token + "==")
    return cbor2.loads(raw)

def verify_rpt(token: str, jti_registry: Optional[set] = None) -> bool:
    obj = decode(token)
    if obj.get("t") != "rpt" or obj.get("v") != 1: return False
    p_bytes: bytes = obj["p"]; vk_bytes: bytes = obj["s"]; sig: bytes = obj["sig"]
    vk = nacl.signing.VerifyKey(vk_bytes)
    try:
        vk.verify(RPT_TAG + p_bytes, sig)
    except Exception:
        return False
    payload_list = cbor2.loads(p_bytes)
    d = {k: v for k, v in payload_list}
    if int(d["expiry_ts"]) < _now() - 30: return False
    if jti_registry is not None:
        jti = d["nonce"]
        if jti in jti_registry: return False
        jti_registry.add(jti)
    return True

def introspect(token: str) -> dict:
    o = decode(token)
    d = {k: v for k, v in cbor2.loads(o["p"])}
    d["verify_key_b64"] = base64.b64encode(o["s"]).decode("ascii")
    return d
"@
W "libs/py-sdk/apgms_sdk/rpt.py" $rpt

$testrpt = @"
import os, time, nacl.signing
from apgms_sdk.rpt import issue_rpt, verify_rpt, introspect

def test_issue_verify_replay():
    sk = nacl.signing.SigningKey.generate()
    payload = {
        "entity_id":"ent-1","period_id":"2025-09","tax_type":"GST","amount_cents":12345,
        "merkle_root":"00"*32,"running_balance_hash":"11"*32,
        "anomaly_vector":{"variance_ratio":0.9},"thresholds":{"variance_ratio":1.5},
        "rail_id":"EFT","destination_id":"ATO-PRN-TEST",
        "expiry_ts":int(time.time())+60,"reference":"RPT-1","nonce":os.urandom(8).hex()
    }
    tok = issue_rpt(payload, bytes(sk))
    seen = set()
    assert verify_rpt(tok, seen)
    assert not verify_rpt(tok, seen)  # replay blocked
    info = introspect(tok)
    assert info["tax_type"] == "GST"
"@
W "libs/py-sdk/tests/test_rpt.py" $testrpt

# --- P01 JSON Schemas ---
$payroll = @"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PayrollEventV1",
  "type": "object",
  "required": ["version","event_type","monotonic_seq","dedupe_key","src_hash","signed_at","producer_id","employee_tax_file_number","gross_cents","pay_period_start","pay_period_end","withholding_cents"],
  "properties": {
    "version": {"const": "v1"},
    "event_type": {"const": "payroll"},
    "monotonic_seq": {"type": "integer", "minimum": 0},
    "dedupe_key": {"type": "string", "minLength": 8},
    "src_hash": {"type": "string", "pattern": "^[A-Fa-f0-9]{64}$"},
    "signed_at": {"type": "string", "format": "date-time"},
    "producer_id": {"type": "string"},
    "employee_tax_file_number": {"type": "string"},
    "employee_id": {"type": ["string","null"]},
    "pay_period_start": {"type": "string", "format": "date"},
    "pay_period_end": {"type": "string", "format": "date"},
    "gross_cents": {"type": "integer", "minimum": 0},
    "withholding_cents": {"type": "integer", "minimum": 0},
    "super_cents": {"type": ["integer","null"], "minimum": 0},
    "notes": {"type": ["string","null"]}
  }
}
"@
W "libs/schemas/json/payroll_event.v1.json" $payroll

$pos = @"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "POSEventV1",
  "type": "object",
  "required": ["version","event_type","monotonic_seq","dedupe_key","src_hash","signed_at","producer_id","txn_id","lines"],
  "properties": {
    "version": {"const": "v1"},
    "event_type": {"const": "pos"},
    "monotonic_seq": {"type": "integer", "minimum": 0},
    "dedupe_key": {"type": "string"},
    "src_hash": {"type": "string", "pattern": "^[A-Fa-f0-9]{64}$"},
    "signed_at": {"type": "string", "format": "date-time"},
    "producer_id": {"type": "string"},
    "txn_id": {"type": "string"},
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["sku","qty","unit_price_cents","tax_code"],
        "properties": {
          "sku": {"type": "string"},
          "qty": {"type": "number"},
          "unit_price_cents": {"type": "integer"},
          "discount_cents": {"type": ["integer","null"], "minimum": 0},
          "tax_code": {"type": "string", "enum": ["GST","GST_FREE","INPUT_TAXED"]},
          "return_for_txn": {"type": ["string","null"]}
        }
      }
    }
  }
}
"@
W "libs/schemas/json/pos_event.v1.json" $pos

$bank = @"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "BankEventV1",
  "type": "object",
  "required": ["version","event_type","monotonic_seq","dedupe_key","src_hash","signed_at","producer_id","direction","amount_cents","reference"],
  "properties": {
    "version": {"const": "v1"},
    "event_type": {"const": "bank"},
    "monotonic_seq": {"type": "integer"},
    "dedupe_key": {"type": "string"},
    "src_hash": {"type": "string", "pattern": "^[A-Fa-f0-9]{64}$"},
    "signed_at": {"type": "string", "format": "date-time"},
    "producer_id": {"type": "string"},
    "direction": {"type": "string", "enum": ["CREDIT","DEBIT"]},
    "amount_cents": {"type": "integer"},
    "reference": {"type": "string"},
    "rail_id": {"type": ["string","null"]},
    "bank_receipt_hash": {"type": ["string","null"]}
  }
}
"@
W "libs/schemas/json/bank_event.v1.json" $bank

$recon = @"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ReconTransitionV1",
  "type": "object",
  "required": ["version","period_id","tax_type","from","to","at","reason"],
  "properties": {
    "version": {"const": "v1"},
    "period_id": {"type": "string", "pattern": "^\\d{4}-\\d{2}$"},
    "tax_type": {"type": "string", "enum": ["GST","PAYGW"]},
    "from": {"type": "string"},
    "to": {"type": "string"},
    "at": {"type": "string", "format": "date-time"},
    "reason": {"type": "string"}
  }
}
"@
W "libs/schemas/json/recon_transition.v1.json" $recon

$err = @"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ErrorEnvelopeV1",
  "type": "object",
  "required": ["version","code","message","occurred_at","dedupe_key"],
  "properties": {
    "version": {"const": "v1"},
    "code": {"type": "string"},
    "message": {"type": "string"},
    "occurred_at": {"type": "string", "format": "date-time"},
    "dedupe_key": {"type": "string"},
    "context": {"type": "object"}
  }
}
"@
W "libs/schemas/json/error_envelope.v1.json" $err

# --- Codegen (TS & Python models from JSON schema) ---
$gen = @"
import json, pathlib
SRC = pathlib.Path(__file__).resolve().parents[1]/"json"
OUT_TS = pathlib.Path(__file__).resolve().parents[2]/"node-sdk"/"schemas.ts"
OUT_PY = pathlib.Path(__file__).resolve().parents[2]/"py-sdk"/"apgms_sdk"/"schemas.py"

TS_HEADER = "// AUTO-GENERATED. Do not edit.\n\n"
PY_HEADER = "# AUTO-GENERATED. Do not edit.\nfrom pydantic import BaseModel\nfrom typing import Optional, Literal, List, Dict\n\n"

def to_ts(name, props, required):
    body=[]
    for k,v in props.items():
        t="any"
        if v.get("type")=="string": t="string"
        elif v.get("type") in ("integer","number"): t="number"
        elif v.get("type")=="array": t="any[]"
        elif v.get("type")=="object": t="Record[str, any]"
        if "enum" in v: t=" | ".join([json.dumps(x) for x in v["enum"]])
        opt="" if k in required else "?"
        body.append(f"  {k}{opt}: {t};")
    return "export interface "+name+" {\n"+("\n".join(body))+"\n}\n\n"

def to_py(name, props, required):
    lines=[f"class {name}(BaseModel):"]
    for k,v in props.items():
        t="str"
        if v.get("type") in ("integer","number"): t="int"
        elif v.get("type")=="array": t="list"
        elif v.get("type")=="object": t="dict"
        if "enum" in v: t="Literal["+(",".join([repr(x) for x in v["enum"]]))+"]"
        default="" if k in required else " | None = None"
        lines.append(f"    {k}: {t}{default}")
    return "\n".join(lines)+"\n\n"

schemas=[]
for p in SRC.glob("*.json"):
    sc=json.loads(p.read_text())
    name=p.stem.split('.')[0].title().replace('_','')+"V1"
    schemas.append((name, sc))

OUT_TS.parent.mkdir(parents=True, exist_ok=True)
with open(OUT_TS,"w",encoding="utf-8") as f:
    f.write(TS_HEADER)
    for name, sc in schemas:
        f.write(to_ts(name, sc.get("properties",{}), set(sc.get("required",[]))))

OUT_PY.parent.mkdir(parents=True, exist_ok=True)
with open(OUT_PY,"w",encoding="utf-8") as f:
    f.write(PY_HEADER)
    for name, sc in schemas:
        f.write(to_py(name, sc.get("properties",{}), set(sc.get("required",[]))))
"@
W "libs/schemas/codegen/generate.py" $gen

# --- Minimal tax rules + tests (P05) ---
$rules = @"
from typing import Literal
def gst_line_tax(amount_cents: int, tax_code: Literal['GST','GST_FREE','INPUT_TAXED']) -> int:
    if tax_code == 'GST':
        return int(round((amount_cents/100.0) * 0.1))
    return 0
def paygw_weekly(withholdable_cents: int) -> int:
    if withholdable_cents <= 87000:
        return int(round(withholdable_cents * 0.15))
    return int(round(87000*0.15 + (withholdable_cents-87000)*0.32))
"@
W "apps/services/tax-engine/app/tax_rules.py" $rules

$testrules = @"
from app.tax_rules import gst_line_tax, paygw_weekly
def test_gst_line_tax():
    assert gst_line_tax(10000,'GST')==1000
    assert gst_line_tax(10000,'GST_FREE')==0
def test_paygw_weekly():
    assert paygw_weekly(50000)==7500
    assert paygw_weekly(100000)>15000
"@
W "apps/services/tax-engine/tests/test_tax_rules.py" $testrules

# --- Tiny evolution test (P01) ---
$evo = @"
from pathlib import Path; import json
def test_required_fields_stable():
    p = Path(__file__).resolve().parents[2]/'json'/'payroll_event.v1.json'
    sc = json.loads(p.read_text())
    assert 'employee_tax_file_number' in sc['required']
"@
W "libs/schemas/tests/test_evolution.py" $evo

Write-Host "`n[Phase 1-min] Files written."
