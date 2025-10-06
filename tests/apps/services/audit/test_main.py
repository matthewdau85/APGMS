from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import sys
import types

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

fake_psycopg2 = types.ModuleType("psycopg2")
fake_psycopg2.Error = Exception

fake_psycopg2_pool = types.ModuleType("psycopg2.pool")
fake_psycopg2_pool.SimpleConnectionPool = object  # type: ignore[attr-defined]

fake_psycopg2_extras = types.ModuleType("psycopg2.extras")
fake_psycopg2_extras.RealDictCursor = object  # type: ignore[attr-defined]

fake_psycopg2.pool = fake_psycopg2_pool
fake_psycopg2.extras = fake_psycopg2_extras

sys.modules.setdefault("psycopg2", fake_psycopg2)
sys.modules.setdefault("psycopg2.pool", fake_psycopg2_pool)
sys.modules.setdefault("psycopg2.extras", fake_psycopg2_extras)

from apps.services.audit import main


class FakeCursor:
    def __init__(self, data: Dict[str, Any]) -> None:
        self._data = data
        self._last_query: Optional[str] = None
        self._results: List[Dict[str, Any]] = []

    def execute(self, query: str, params: Optional[tuple] = None) -> None:
        self._last_query = " ".join(query.split())
        period_id_param = params[0] if params else None
        if "FROM rpt_store" in self._last_query:
            row = self._data["rpt_store"].get(period_id_param)
            self._results = [row] if row else []
        elif "FROM audit_log" in self._last_query:
            matched: List[Dict[str, Any]] = []
            if period_id_param:
                for key, rows in self._data["audit_log"].items():
                    if key in str(period_id_param):
                        matched = rows
                        break
            self._results = matched
        else:
            self._results = [{"?column?": 1}]

    def fetchone(self) -> Optional[Dict[str, Any]]:
        return self._results[0] if self._results else None

    def fetchall(self) -> List[Dict[str, Any]]:
        return list(self._results)

    def close(self) -> None:  # pragma: no cover - interface compliance
        pass


class FakeConnection:
    def __init__(self, data: Dict[str, Any]) -> None:
        self._data = data

    def cursor(self, cursor_factory=None):  # pragma: no cover - signature parity
        return FakeCursor(self._data)

    def rollback(self) -> None:  # pragma: no cover - interface compliance
        pass


class FakePool:
    def __init__(self, data: Dict[str, Any]) -> None:
        self._data = data

    def getconn(self) -> FakeConnection:
        return FakeConnection(self._data)

    def putconn(self, _conn: FakeConnection) -> None:  # pragma: no cover - compliance
        pass

    def closeall(self) -> None:  # pragma: no cover - compliance
        pass


@pytest.fixture(autouse=True)
def patch_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AUDIT_SKIP_POOL_INIT", "1")
    fake_data = {
        "rpt_store": {
            "2024-01": {
                "rpt_json": {"foo": "bar"},
                "rpt_sig": "sig",
                "issued_at": datetime(2024, 1, 1, 12, 0, 0),
            }
        },
        "audit_log": {
            "2024-01": [
                {
                    "event_time": datetime(2024, 1, 1, 12, 0, 0),
                    "category": "info",
                    "message": '{"period_id":"2024-01"}',
                },
                {
                    "event_time": datetime(2024, 1, 1, 13, 30, 0),
                    "category": "warning",
                    "message": '{"period_id":"2024-01","status":"late"}',
                },
            ]
        },
    }

    monkeypatch.setattr(main, "_POOL", FakePool(fake_data))
    yield
    main.close_pool()


def test_bundle_returns_audit_rows() -> None:
    with TestClient(main.app) as client:
        response = client.get("/audit/bundle/2024-01")

    assert response.status_code == 200
    body = response.json()
    assert body["period_id"] == "2024-01"
    assert body["rpt"] == {
        "rpt_json": {"foo": "bar"},
        "rpt_sig": "sig",
        "issued_at": "2024-01-01T12:00:00",
    }
    assert body["audit"] == [
        {
            "event_time": "2024-01-01T12:00:00",
            "category": "info",
            "message": '{"period_id":"2024-01"}',
        },
        {
            "event_time": "2024-01-01T13:30:00",
            "category": "warning",
            "message": '{"period_id":"2024-01","status":"late"}',
        },
    ]


def test_healthz_uses_pool() -> None:
    with TestClient(main.app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
