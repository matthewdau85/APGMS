#!/usr/bin/env python3
"""Load PAYGW and GST rate tables into a versioned schema."""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import uuid
import hashlib
from dataclasses import dataclass
from typing import List, Optional, Dict, Any

try:
    import psycopg
    from psycopg.conninfo import make_conninfo
except ModuleNotFoundError as exc:  # pragma: no cover - import guard for packaging
    raise SystemExit("psycopg is required to load rates tables") from exc

DEFAULT_PENALTY_CONFIG = {
    "penaltyUnitCents": 31300,
    "unitMultiplier": 1,
    "daysPerUnit": 28,
    "maxUnits": 5,
    "gicDailyRateBasisPoints": 32,
    "gicCapBasisPoints": 7500,
    "totalCapBasisPoints": 25000,
}

@dataclass
class PaygwBracket:
    min_cents: int
    max_cents: Optional[int]
    base_tax_cents: int
    rate_bp: int


def _parse_int(value: str, field: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid integer for {field}: {value!r}") from exc


def load_paygw(path: str) -> List[PaygwBracket]:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        required = {"min_cents", "max_cents", "base_tax_cents", "rate_bp"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"PAYGW CSV missing columns: {', '.join(sorted(missing))}")
        brackets: List[PaygwBracket] = []
        for row in reader:
            max_val = row["max_cents"].strip()
            brackets.append(
                PaygwBracket(
                    min_cents=_parse_int(row["min_cents"], "min_cents"),
                    max_cents=_parse_int(max_val, "max_cents") if max_val else None,
                    base_tax_cents=_parse_int(row["base_tax_cents"], "base_tax_cents"),
                    rate_bp=_parse_int(row["rate_bp"], "rate_bp"),
                )
            )
    brackets.sort(key=lambda b: b.min_cents)
    return brackets


def load_gst(path: str) -> int:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames or "rate_bp" not in reader.fieldnames:
            raise ValueError("GST CSV must contain a rate_bp column")
        rows = list(reader)
        if not rows:
            raise ValueError("GST CSV is empty")
        return _parse_int(rows[0]["rate_bp"], "rate_bp")


def load_penalty_config(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        return DEFAULT_PENALTY_CONFIG.copy()
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    config = DEFAULT_PENALTY_CONFIG.copy()
    config.update(data)
    return config


def compute_checksum(paygw: List[PaygwBracket], gst_rate_bp: int, penalty_config: Dict[str, Any]) -> str:
    lines = []
    for bracket in sorted(paygw, key=lambda b: b.min_cents):
        max_part = "" if bracket.max_cents is None else str(bracket.max_cents)
        lines.append(f"paygw,{bracket.min_cents},{max_part},{bracket.base_tax_cents},{bracket.rate_bp}")
    lines.append(f"gst,{gst_rate_bp}")
    for key in sorted(penalty_config.keys()):
        lines.append(f"penalty,{key},{penalty_config[key]}")
    digest = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
    return digest


def build_conninfo() -> str:
    if url := os.environ.get("DATABASE_URL"):
        return url
    params: Dict[str, Any] = {}
    for env_key, param in (
        ("PGHOST", "host"),
        ("PGPORT", "port"),
        ("PGUSER", "user"),
        ("PGPASSWORD", "password"),
        ("PGDATABASE", "dbname"),
    ):
        value = os.environ.get(env_key)
        if value:
            params[param] = value
    if not params.get("user") or not params.get("dbname"):
        raise SystemExit("PGUSER/PGDATABASE or DATABASE_URL must be set")
    return make_conninfo(**params)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Load ATO rates into Postgres")
    parser.add_argument("--paygw-csv", required=True, help="Path to PAYGW brackets CSV")
    parser.add_argument("--gst-csv", required=True, help="Path to GST rates CSV")
    parser.add_argument("--version-name", required=True, help="Friendly name for the rates version")
    parser.add_argument("--effective-from", required=True, help="ISO date the version becomes active")
    parser.add_argument("--effective-to", help="ISO date the version expires (optional)")
    parser.add_argument("--version-id", help="Explicit UUID for the rates version")
    parser.add_argument("--penalty-config", help="JSON file overriding penalty configuration")
    args = parser.parse_args(argv)

    paygw = load_paygw(args.paygw_csv)
    gst_rate = load_gst(args.gst_csv)
    penalty_config = load_penalty_config(args.penalty_config)
    checksum = compute_checksum(paygw, gst_rate, penalty_config)
    version_id = args.version_id or str(uuid.uuid4())

    conninfo = build_conninfo()
    with psycopg.connect(conninfo) as conn, conn.transaction():
        with conn.cursor() as cur:
            cur.execute("select 1 from rates_version where id=%s", (version_id,))
            exists = cur.fetchone() is not None
            if exists:
                cur.execute("delete from paygw_brackets where version_id=%s", (version_id,))
                cur.execute("delete from gst_version where version_id=%s", (version_id,))
                cur.execute(
                    "update rates_version set name=%s,effective_from=%s,effective_to=%s,checksum_sha256=%s,penalty_config=%s where id=%s",
                    (
                        args.version_name,
                        args.effective_from,
                        args.effective_to,
                        checksum,
                        json.dumps(penalty_config),
                        version_id,
                    ),
                )
            else:
                cur.execute(
                    "insert into rates_version(id,name,effective_from,effective_to,checksum_sha256,penalty_config) values (%s,%s,%s,%s,%s,%s)",
                    (
                        version_id,
                        args.version_name,
                        args.effective_from,
                        args.effective_to,
                        checksum,
                        json.dumps(penalty_config),
                    ),
                )
            for bracket in paygw:
                cur.execute(
                    "insert into paygw_brackets(version_id,min_cents,max_cents,base_tax_cents,rate_basis_points) values (%s,%s,%s,%s,%s)",
                    (
                        version_id,
                        bracket.min_cents,
                        bracket.max_cents,
                        bracket.base_tax_cents,
                        bracket.rate_bp,
                    ),
                )
            cur.execute(
                "insert into gst_version(version_id, rate_basis_points) values (%s,%s)",
                (version_id, gst_rate),
            )
    print(f"Loaded rates version {version_id} ({args.version_name}) with checksum {checksum}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
