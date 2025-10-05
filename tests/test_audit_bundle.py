from datetime import datetime
import sys
from pathlib import Path
import types

sys.path.append(str(Path(__file__).resolve().parents[1]))

if "psycopg2" not in sys.modules:
    sys.modules["psycopg2"] = types.SimpleNamespace(connect=lambda *_, **__: None)

from apps.services.audit import main as audit_main


class FakeCursor:
    def __init__(self, rpt_row, audit_rows):
        self._rpt_row = rpt_row
        self._audit_rows = audit_rows

    def execute(self, *_args, **_kwargs):
        # The real cursor just runs the query; we don't need to emulate it.
        pass

    def fetchone(self):
        return self._rpt_row

    def fetchall(self):
        return list(self._audit_rows)

    def close(self):
        pass


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor

    def close(self):
        pass


def test_bundle_returns_all_audit_rows(monkeypatch):
    period_id = "2024-Q1"
    rpt_row = ("{\"foo\": \"bar\"}", "signature", datetime(2024, 1, 1, 0, 0, 0))
    audit_rows = [
        (datetime(2024, 1, 1, 0, 0, 0), "ingest", "start"),
        (datetime(2024, 1, 1, 1, 0, 0), "ingest", "complete"),
    ]
    fake_cursor = FakeCursor(rpt_row, audit_rows)
    fake_conn = FakeConnection(fake_cursor)

    monkeypatch.setattr(audit_main, "db", lambda: fake_conn)

    response = audit_main.bundle(period_id)

    assert response["period_id"] == period_id
    assert response["rpt"] == rpt_row[0]
    assert response["audit"] == [
        {"event_time": str(row[0]), "category": row[1], "message": row[2]} for row in audit_rows
    ]
    assert len(response["audit"]) == 2
