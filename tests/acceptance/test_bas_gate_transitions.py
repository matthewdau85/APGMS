# tests/acceptance/test_bas_gate_transitions.py
from fastapi.testclient import TestClient
from types import SimpleNamespace
from pathlib import Path
import importlib.util
import types
import sys
import pytest

try:
    import psycopg2  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - offline test fallback
    psycopg2 = types.ModuleType("psycopg2")

    class _Error(Exception):
        pgcode: str | None = None
        diag: object | None = None

    psycopg2.Error = _Error  # type: ignore[attr-defined]

    def _connect(*args, **kwargs):  # pragma: no cover - not used in test
        raise RuntimeError("psycopg2.connect is not available in test stub")

    psycopg2.connect = _connect  # type: ignore[attr-defined]
    sys.modules["psycopg2"] = psycopg2

_MODULE_PATH = Path(__file__).resolve().parents[2] / "apps" / "services" / "bas-gate" / "main.py"
spec = importlib.util.spec_from_file_location("bas_gate_main", _MODULE_PATH)
bas_gate_main = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(bas_gate_main)


class FakeTransitionError(psycopg2.Error):
    def __init__(self, message: str, hint: str):
        super().__init__(message)
        self.pgcode = "P0001"
        self.diag = SimpleNamespace(message_primary=message, hint=hint)


class FakeCursor:
    def __init__(self):
        self._row = ("prev-hash",)
        self.updated_state = None
        self.closed = False

    def execute(self, query, params=None):
        if "SELECT hash_this" in query:
            self._row = ("prev-hash",)
        elif "set_config" in query:
            return
        elif "UPDATE bas_gate_states" in query:
            self.updated_state = params[0]
            raise FakeTransitionError(
                "Invalid BAS gate transition from RECONCILING to %s" % params[0],
                "Resolve recon issues or clear BLOCKED state before retry."
            )
        elif "INSERT INTO audit_log" in query:
            return
        elif "INSERT INTO bas_gate_states" in query:
            return
        else:
            return

    def fetchone(self):
        return self._row

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self):
        self.cursor_obj = FakeCursor()
        self.rolled_back = False
        self.closed = False
        self._committed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self._committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.fixture
def fake_db(monkeypatch):
    connections: list[FakeConnection] = []

    def make_conn():
        conn = FakeConnection()
        connections.append(conn)
        return conn

    monkeypatch.setattr(bas_gate_main, "db", make_conn)
    return connections


def test_invalid_transition_surface_conflict(fake_db):
    client = TestClient(bas_gate_main.app)

    resp = client.post(
        "/gate/transition",
        json={
            "period_id": "2024Q4",
            "target_state": "released",
            "reason_code": "manual override",
            "actor": "ops",
            "trace_id": "trace-123"
        },
    )

    assert resp.status_code == 409
    body = resp.json()
    assert body["detail"]["error"] == "invalid_transition"
    assert "Resolve recon issues" in body["detail"]["hint"]

    fake_conn = fake_db[-1]
    # ensure uppercase state enforcement and rollback executed
    assert fake_conn.cursor_obj.updated_state == "RELEASED"
    assert fake_conn.rolled_back
    assert fake_conn.closed
    assert fake_conn.cursor_obj.closed
