from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Iterable, Tuple

import pytest

try:
    import psycopg
    from psycopg import sql
except ModuleNotFoundError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    sql = None  # type: ignore[assignment]

try:
    from nacl import signing
except ModuleNotFoundError:  # pragma: no cover
    signing = None  # type: ignore[assignment]

MIGRATION_SEQUENCE = [
    Path("migrations/001_apgms_core.sql"),
    Path("migrations/002_patent_extensions.sql"),
]

DEFAULT_DB = "apgms_ci"


@pytest.fixture(scope="module")
def ensure_dependencies() -> None:
    if psycopg is None:
        pytest.skip("psycopg not installed")
    if signing is None:
        pytest.skip("PyNaCl not installed")


def _admin_dsn() -> str:
    return os.getenv("APGMS_TEST_ADMIN_DSN", "postgresql://postgres:postgres@localhost:5432/postgres")


def _reset_database(admin: "psycopg.Connection", name: str) -> None:
    with admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))
        admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(name)))


def _connect_db(name: str) -> "psycopg.Connection":
    dsn = _admin_dsn().rsplit("/", 1)[0] + f"/{name}"
    return psycopg.connect(dsn, autocommit=True)


def _apply_migrations(conn: "psycopg.Connection", paths: Iterable[Path]) -> None:
    for path in paths:
        sql_text = path.read_text(encoding="utf-8-sig")
        conn.execute(sql_text)


def _seed_period(conn: "psycopg.Connection", abn: str, tax_type: str, period_id: str) -> None:
    conn.execute(
        """
        INSERT INTO periods (abn, tax_type, period_id, state, accrued_cents, credited_to_owa_cents,
                             final_liability_cents, merkle_root, running_balance_hash)
        VALUES (%s, %s, %s, 'OPEN', 0, 0, 0, 'seed_merkle', 'seed_rbh')
        ON CONFLICT (abn, tax_type, period_id) DO NOTHING
        """,
        (abn, tax_type, period_id),
    )


def _append_credit(conn: "psycopg.Connection", abn: str, tax_type: str, period_id: str, amount: int) -> None:
    conn.execute("SELECT * FROM owa_append(%s,%s,%s,%s,%s)", (abn, tax_type, period_id, amount, None))


def _sync_totals(conn: "psycopg.Connection", abn: str, tax_type: str, period_id: str) -> None:
    conn.execute("SELECT periods_sync_totals(%s,%s,%s)", (abn, tax_type, period_id))


def _close_period(conn: "psycopg.Connection", abn: str, tax_type: str, period_id: str) -> None:
    conn.execute(
        "UPDATE periods SET state='CLOSING' WHERE abn=%s AND tax_type=%s AND period_id=%s",
        (abn, tax_type, period_id),
    )


def _insert_rpt_token(
    conn: "psycopg.Connection",
    signer: "signing.SigningKey",
    abn: str,
    tax_type: str,
    period_id: str,
) -> Tuple[str, str]:
    payload = {
        "abn": abn,
        "tax_type": tax_type,
        "period_id": period_id,
        "issued_at": "2025-10-01T00:00:00Z",
    }
    canonical = json.dumps(payload, separators=(",", ":"))
    signature = signer.sign(canonical.encode("utf-8")).signature
    signature_b64 = base64.b64encode(signature).decode("ascii")
    payload_sha = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    conn.execute(
        """
        INSERT INTO rpt_tokens (abn, tax_type, period_id, payload, payload_c14n, payload_sha256, signature, status)
        VALUES (%s,%s,%s,%s::jsonb,%s,%s,%s,'ISSUED')
        """,
        (abn, tax_type, period_id, canonical, canonical, payload_sha, signature_b64),
    )
    return canonical, signature_b64


def _prepare_env(db_name: str, public_key_b64: str) -> dict:
    env = os.environ.copy()
    env.update(
        {
            "PGHOST": "127.0.0.1",
            "PGPORT": os.getenv("APGMS_TEST_PGPORT", "5432"),
            "PGUSER": os.getenv("APGMS_TEST_DB_USER", "postgres"),
            "PGPASSWORD": os.getenv("APGMS_TEST_DB_PASSWORD", "postgres"),
            "PGDATABASE": db_name,
            "RPT_PUBLIC_BASE64": public_key_b64,
        }
    )
    return env


@pytest.mark.usefixtures("ensure_dependencies")
def test_seed_to_evidence_roundtrip(tmp_path: Path) -> None:
    admin_dsn = _admin_dsn()
    try:
        admin = psycopg.connect(admin_dsn, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("postgres not available for integration flow test")

    db_name = os.getenv("APGMS_TEST_DB", DEFAULT_DB)
    _reset_database(admin, db_name)

    with _connect_db(db_name) as conn:
        _apply_migrations(conn, MIGRATION_SEQUENCE)
        abn, tax_type, period_id = "12345678901", "GST", "2025-09"
        _seed_period(conn, abn, tax_type, period_id)
        for amount in (50_000, 40_000, 33_456):
            _append_credit(conn, abn, tax_type, period_id, amount)
        _sync_totals(conn, abn, tax_type, period_id)
        _close_period(conn, abn, tax_type, period_id)

        signer = signing.SigningKey.generate()
        canonical, _ = _insert_rpt_token(conn, signer, abn, tax_type, period_id)

    verify_key_b64 = base64.b64encode(bytes(signer.verify_key)).decode("ascii")
    env = _prepare_env(db_name, verify_key_b64)

    verify = subprocess.run(
        ["node", "verify_rpt.js", period_id, abn, tax_type],
        cwd=Path(__file__).resolve().parent.parent,
        env=env,
        capture_output=True,
        text=True,
    )
    if verify.returncode != 0:
        pytest.fail(f"verify_rpt.js failed: {verify.stdout}\n{verify.stderr}")
    assert "VALID" in verify.stdout

    export = subprocess.run(
        ["node", "export_evidence.js", abn, tax_type, period_id],
        cwd=Path(__file__).resolve().parent.parent,
        env=env,
        capture_output=True,
        text=True,
    )
    if export.returncode != 0:
        pytest.fail(f"export_evidence.js failed: {export.stdout}\n{export.stderr}")

    evidence_files = list(tmp_path.glob("evidence_*.json"))
    if not evidence_files:
        # export writes to CWD; move the generated file into tmp_path for inspection
        for generated in Path.cwd().glob(f"evidence_{abn}_{period_id}_{tax_type}.json"):
            generated.rename(tmp_path / generated.name)
        evidence_files = list(tmp_path.glob("evidence_*.json"))
    assert evidence_files, "evidence bundle not produced"

    bundle = json.loads(evidence_files[0].read_text())
    assert bundle["period"]["state"] == "CLOSING"
    assert bundle["rpt"]["payload"]["period_id"] == period_id
    assert len(bundle["owa_ledger"]) == 3
