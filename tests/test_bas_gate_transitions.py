import importlib.util
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
MODULE_PATH = ROOT / "apps" / "services" / "bas-gate" / "main.py"
spec = importlib.util.spec_from_file_location("bas_gate_main", MODULE_PATH)
assert spec and spec.loader is not None
bas_gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bas_gate)  # type: ignore[attr-defined]


class FakeCursor:
    def __init__(self, store):
        self.store = store
        self._queue = []

    def execute(self, sql, params):
        sql = sql.strip()
        if sql.startswith("SELECT state"):
            row = self.store.get("row")
            if row:
                self._queue = [(row["state"], row.get("reason_code"), row.get("hash_this"))]
            else:
                self._queue = []
        elif sql.startswith("INSERT INTO bas_gate_states"):
            period_id, state, reason, hash_prev, hash_this = params
            self.store["row"] = {
                "period_id": period_id,
                "state": state,
                "reason_code": reason,
                "hash_prev": hash_prev,
                "hash_this": hash_this,
            }
            self.store.setdefault("history", []).append((hash_prev, hash_this))
        elif sql.startswith("UPDATE bas_gate_states SET"):
            state, reason, hash_prev, hash_this, period_id = params
            row = self.store["row"]
            assert row["period_id"] == period_id
            row.update(
                {
                    "state": state,
                    "reason_code": reason,
                    "hash_prev": hash_prev,
                    "hash_this": hash_this,
                }
            )
            self.store.setdefault("history", []).append((hash_prev, hash_this))
        elif sql.startswith("INSERT INTO audit_log"):
            payload, prev_hash, hash_this = params
            self.store.setdefault("audit", []).append((payload, prev_hash, hash_this))
        else:
            raise AssertionError(f"unexpected SQL: {sql}")

    def fetchone(self):
        return self._queue.pop(0) if self._queue else None

    def close(self):
        pass


class FakeConn:
    def __init__(self, store):
        self.store = store
        self.cursor_obj = FakeCursor(store)
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def make_fake_db(store):
    def _factory():
        return FakeConn(store)

    return _factory


@pytest.mark.parametrize(
    "prev_state,target_state,prev_reason,new_reason",
    [
        (None, "Open", None, None),
        ("Open", "Pending-Close", None, None),
        ("Open", "Blocked", None, "ops-block"),
        ("Pending-Close", "Reconciling", None, None),
        ("Pending-Close", "Blocked", None, "ops-block"),
        ("Reconciling", "RPT-Issued", None, "issuer"),
        ("Reconciling", "Blocked", None, "ops-block"),
        ("RPT-Issued", "Remitted", "issuer", "remitter"),
        ("RPT-Issued", "Blocked", "issuer", "ops-block"),
        ("Blocked", "Reconciling", "ops-block", None),
        ("Blocked", "Open", "ops-block", None),
    ],
)
def test_allowed_transitions(monkeypatch, prev_state, target_state, prev_reason, new_reason):
    store = {
        "row": None
        if prev_state is None
        else {
            "period_id": "2024Q4",
            "state": prev_state,
            "reason_code": prev_reason,
            "hash_prev": "prev",
            "hash_this": "tail",
        }
    }
    monkeypatch.setattr(bas_gate, "db", make_fake_db(store))

    prior_tail = store["row"]["hash_this"] if store.get("row") else None
    req = bas_gate.TransitionReq(period_id="2024Q4", target_state=target_state, reason_code=new_reason)
    result = bas_gate.transition(req)

    assert result["ok"] is True
    assert "hash" in result
    assert store["row"]["state"] == target_state
    history = store.get("history")
    assert history, "ledger history should be updated"
    prev_hash, new_hash = history[-1]
    assert prev_hash == store["row"].get("hash_prev")
    assert new_hash == store["row"]["hash_this"]
    if prior_tail is not None:
        assert prev_hash == prior_tail


def test_remitted_requires_different_actor(monkeypatch):
    store = {
        "row": {
            "period_id": "2024Q4",
            "state": "RPT-Issued",
            "reason_code": "issuer",
            "hash_prev": "h0",
            "hash_this": "h1",
        }
    }
    monkeypatch.setattr(bas_gate, "db", make_fake_db(store))

    req = bas_gate.TransitionReq(period_id="2024Q4", target_state="Remitted", reason_code="issuer")
    with pytest.raises(HTTPException) as exc:
        bas_gate.transition(req)
    assert exc.value.status_code == 403
    assert store["row"]["state"] == "RPT-Issued"


def test_blocked_requires_reason(monkeypatch):
    store = {
        "row": {
            "period_id": "2024Q4",
            "state": "Open",
            "reason_code": None,
            "hash_prev": "h0",
            "hash_this": "h1",
        }
    }
    monkeypatch.setattr(bas_gate, "db", make_fake_db(store))

    req = bas_gate.TransitionReq(period_id="2024Q4", target_state="Blocked", reason_code=None)
    with pytest.raises(HTTPException) as exc:
        bas_gate.transition(req)
    assert exc.value.status_code == 400


def test_invalid_transition(monkeypatch):
    store = {"row": None}
    monkeypatch.setattr(bas_gate, "db", make_fake_db(store))

    req = bas_gate.TransitionReq(period_id="2024Q4", target_state="Remitted", reason_code="ops")
    with pytest.raises(HTTPException) as exc:
        bas_gate.transition(req)
    assert exc.value.status_code == 409


def test_idempotent_noop(monkeypatch):
    store = {
        "row": {
            "period_id": "2024Q4",
            "state": "Reconciling",
            "reason_code": "ops",
            "hash_prev": "hp",
            "hash_this": "ht",
        }
    }
    monkeypatch.setattr(bas_gate, "db", make_fake_db(store))

    req = bas_gate.TransitionReq(period_id="2024Q4", target_state="Reconciling", reason_code="ops")
    result = bas_gate.transition(req)
    assert result == {"ok": True, "hash": "ht"}
    assert store.get("history") is None
