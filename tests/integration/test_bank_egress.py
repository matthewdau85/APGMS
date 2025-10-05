import hashlib
import importlib.util
import json
from pathlib import Path
from typing import Any, Dict, Optional

import pytest
from fastapi.testclient import TestClient

import sys
import types

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

sys.modules.setdefault("psycopg2", types.SimpleNamespace(connect=lambda *args, **kwargs: None))

from libs.rpt.rpt import sign


def load_bank_app_module():
    module_path = Path(__file__).resolve().parents[2] / "apps" / "services" / "bank-egress" / "main.py"
    spec = importlib.util.spec_from_file_location("bank_egress_main", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)  # type: ignore[arg-type]
    return module


bank_app = load_bank_app_module()


class FakeCursor:
    def __init__(self, conn: "FakeConn") -> None:
        self.conn = conn
        self._result: Optional[Any] = None

    def execute(self, sql: str, params: Optional[tuple] = None) -> None:
        sql = sql.strip()
        params = params or tuple()
        self._result = None

        if sql.startswith("SELECT state, hash_this FROM bas_gate_states"):
            period_id = params[0]
            row = self.conn.gate_states.get(period_id)
            if row:
                self._result = (row["state"], row.get("hash_this"))
        elif sql.startswith("INSERT INTO bank_remittances"):
            period_id, rpt_json, bank_reference, bank_status, receipt_hash, bank_payload = params
            self.conn.bank_remittances[period_id] = {
                "rpt_json": json.loads(rpt_json),
                "bank_reference": bank_reference,
                "bank_status": bank_status,
                "receipt_hash": receipt_hash,
                "bank_payload": json.loads(bank_payload),
            }
        elif sql.startswith("UPDATE bas_gate_states"):
            reason_code, hash_prev, hash_this, period_id = params
            gate = self.conn.gate_states.setdefault(period_id, {})
            gate.update(
                {
                    "state": "Remitted",
                    "reason_code": reason_code,
                    "hash_prev": hash_prev,
                    "hash_this": hash_this,
                }
            )
        elif sql.startswith("SELECT hash_this FROM audit_log"):
            if self.conn.audit_log:
                self._result = (self.conn.audit_log[-1]["hash_this"],)
            else:
                self._result = (None,)
        elif sql.startswith("INSERT INTO audit_log"):
            category, message, hash_prev, hash_this = params
            self.conn.audit_log.append(
                {
                    "category": category,
                    "message": json.loads(message),
                    "hash_prev": hash_prev,
                    "hash_this": hash_this,
                }
            )
        elif sql.startswith("SELECT state FROM bas_gate_states"):
            period_id = params[0]
            row = self.conn.gate_states.get(period_id)
            if row:
                self._result = (row.get("state"),)
        else:  # pragma: no cover - guard for unexpected SQL
            raise AssertionError(f"Unhandled SQL: {sql}")

    def fetchone(self):
        return self._result

    def close(self) -> None:  # pragma: no cover - interface compatibility
        pass


class FakeConn:
    def __init__(self) -> None:
        self.gate_states: Dict[str, Dict[str, Any]] = {}
        self.bank_remittances: Dict[str, Dict[str, Any]] = {}
        self.audit_log: list[Dict[str, Any]] = []
        self.committed = False

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.committed = True

    def close(self) -> None:  # pragma: no cover
        pass


@pytest.fixture
def fake_conn(monkeypatch):
    conn = FakeConn()
    conn.gate_states["2025-09"] = {"state": "RPT-Issued", "hash_this": "prevhash"}
    monkeypatch.setattr(bank_app, "db", lambda: conn)
    return conn


def make_signed_rpt(period_id: str) -> Dict[str, Any]:
    payload = {
        "period_id": period_id,
        "paygw_total": 100.0,
        "gst_total": 200.0,
        "source_digests": {},
        "anomaly_score": 0.05,
        "expires_at": 1_700_000_000,
        "nonce": "abc123",
    }
    payload["signature"] = sign(payload)
    return payload


def test_remit_success(monkeypatch, fake_conn):
    def fake_bank(payload: Dict[str, Any]):
        assert payload["period_id"] == "2025-09"
        assert "rpt" in payload
        return {
            "status": "SETTLED",
            "bank_reference": "BR-001",
            "receipt": "rcpt-xyz",
        }

    monkeypatch.setattr(bank_app, "_post_bank", fake_bank)

    client = TestClient(bank_app.app)
    rpt = make_signed_rpt("2025-09")
    response = client.post("/egress/remit", json={"period_id": "2025-09", "rpt": rpt})

    assert response.status_code == 200
    data = response.json()
    expected_hash = hashlib.sha256(b"rcpt-xyz").hexdigest()
    assert data == {
        "ok": True,
        "bank_reference": "BR-001",
        "receipt_hash": expected_hash,
        "status": "SETTLED",
    }

    remit = fake_conn.bank_remittances["2025-09"]
    assert remit["bank_reference"] == "BR-001"
    assert remit["receipt_hash"] == expected_hash
    assert fake_conn.gate_states["2025-09"]["state"] == "Remitted"
    assert fake_conn.audit_log[-1]["message"]["receipt_hash"] == expected_hash


def test_bank_error_rolls_back(monkeypatch, fake_conn):
    import httpx

    def fake_bank(_payload: Dict[str, Any]):
        raise httpx.HTTPError("bank down")

    monkeypatch.setattr(bank_app, "_post_bank", fake_bank)

    client = TestClient(bank_app.app)
    rpt = make_signed_rpt("2025-09")
    response = client.post("/egress/remit", json={"period_id": "2025-09", "rpt": rpt})

    assert response.status_code == 502
    assert "bank error" in response.text
    assert fake_conn.bank_remittances == {}
    assert fake_conn.gate_states["2025-09"]["state"] == "RPT-Issued"
    assert not fake_conn.audit_log

