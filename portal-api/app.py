import copy
import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel

app = FastAPI(title="APGMS Portal API", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
BINDINGS_PATH = BASE_DIR / "provider_bindings.json"
CAPABILITY_STATE_PATH = BASE_DIR / "capability_state.json"


def _load_provider_bindings() -> Dict[str, Dict[str, Any]]:
    if not BINDINGS_PATH.exists():
        raise RuntimeError(f"Missing provider bindings file at {BINDINGS_PATH}")
    with BINDINGS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise RuntimeError("Provider bindings must be a JSON object keyed by deploy color")
    normalized: Dict[str, Dict[str, Any]] = {}
    for key, value in data.items():
        normalized[key.lower()] = value
    return normalized


def _load_capability_state() -> Dict[str, Any]:
    if not CAPABILITY_STATE_PATH.exists():
        # initialize with defaults derived from bindings
        bindings = _load_provider_bindings()
        default_state = {
            color: {
                "ready": color == "blue",  # blue live by default
                "checks": {
                    "api": "ready" if color == "blue" else "provisioning",
                    "normalizer": "ready" if color == "blue" else "provisioning",
                    "reporting": "ready" if color == "blue" else "provisioning",
                },
                "lastUpdated": None,
            }
            for color in bindings.keys()
        }
        CAPABILITY_STATE_PATH.write_text(json.dumps(default_state, indent=2), encoding="utf-8")
    with CAPABILITY_STATE_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    normalized: Dict[str, Any] = {}
    for color, details in data.items():
        normalized[color.lower()] = details
    return normalized


def _write_capability_state(state: Dict[str, Any]) -> None:
    CAPABILITY_STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


PROVIDER_BINDINGS = _load_provider_bindings()
PROVIDER_ENV_KEYS = {
    "auth": "AUTH_PROVIDER_ENDPOINT",
    "banking": "BANKING_PROVIDER_ENDPOINT",
    "ledger": "LEDGER_PROVIDER_ENDPOINT",
}


def _get_color_from_env() -> str:
    color = os.getenv("DEPLOY_COLOR", "blue").lower()
    if color not in PROVIDER_BINDINGS:
        raise RuntimeError(
            f"DEPLOY_COLOR='{color}' is not defined in provider_bindings.json"
        )
    return color

@app.get("/readyz")
def readyz(): return {"ok": True, "ts": time.time()}


@app.get("/deploy/status")
def deploy_status():
    color = _get_color_from_env()
    state = _load_capability_state()
    capability = state.get(color, {})
    bindings = _bindings_for_color(color)
    return {
        "activeColor": color,
        "bindings": bindings,
        "capabilityMatrix": capability,
    }


class CapabilityUpdate(BaseModel):
    color: str
    ready: bool
    checks: Dict[str, str] | None = None
    note: str | None = None


@app.post("/deploy/capability-matrix")
def update_capability_matrix(update: CapabilityUpdate):
    color = update.color.lower()
    if color not in PROVIDER_BINDINGS:
        raise HTTPException(status_code=400, detail=f"Unknown deploy color '{update.color}'")

    state = _load_capability_state()
    entry = state.setdefault(color, {"checks": {}, "ready": False, "lastUpdated": None})
    if update.checks is not None:
        entry["checks"] = update.checks
    entry["ready"] = update.ready
    entry["lastUpdated"] = time.time()
    if update.note:
        entry["note"] = update.note
    _write_capability_state(state)
    return {"ok": True, "color": color, "ready": entry["ready"]}


def _bindings_for_color(color: str) -> Dict[str, Any]:
    base = PROVIDER_BINDINGS[color]
    bindings: Dict[str, Any] = copy.deepcopy(base)
    providers = bindings.setdefault("providers", {})
    overrides: Dict[str, str] = {}
    for logical_name, env_key in PROVIDER_ENV_KEYS.items():
        val = os.getenv(env_key)
        if val:
            overrides[logical_name] = val
    if overrides:
        providers.update(overrides)
        bindings["overrides"] = sorted(overrides.keys())
    return bindings

@app.get("/metrics", response_class=None)
def metrics():
    return ("\n".join([
        "# HELP portal_up 1 if up",
        "# TYPE portal_up gauge",
        "portal_up 1"
    ]))

@app.get("/dashboard/yesterday")
def yesterday():
    return {"jobs": 3, "success_rate": 0.97, "top_errors": []}

@app.post("/normalize")
def normalize(payload: Dict[str, Any]):
    return {"received": True, "size": sum(len(str(v)) for v in payload.values())}

class ConnStart(BaseModel):
    type: str
    provider: str

_connections: List[Dict[str, Any]] = []

@app.get("/connections")
def list_connections(): return _connections

@app.post("/connections/start")
def start_conn(req: ConnStart):
    color = _get_color_from_env()
    bindings = _bindings_for_color(color)
    providers = bindings.get("providers", {})
    if req.provider not in providers:
        raise HTTPException(status_code=400, detail=f"Provider '{req.provider}' not bound for {color}")
    base_url = providers[req.provider]
    url = f"{base_url.rstrip('/')}/authorize?state=fake"
    return {"url": url, "color": color}

@app.delete("/connections/{conn_id}")
def delete_conn(conn_id: int):
    global _connections
    _connections = [c for c in _connections if c.get("id") != conn_id]
    return {"ok": True}

@app.get("/transactions")
def transactions(q: str = "", source: str = ""):
    items = [
        {"date":"2025-10-03","source":"bank","description":"Coffee","amount":-4.5,"category":"Meals"},
        {"date":"2025-10-03","source":"pos","description":"Sale #1234","amount":120.0,"category":"Sales"},
    ]
    if q: items = [t for t in items if q.lower() in t["description"].lower()]
    if source: items = [t for t in items if t["source"]==source]
    return {"items": items, "sources": sorted({t["source"] for t in items})}

@app.get("/ato/status")
def ato_status():
    return {"status":"Disconnected"}

@app.post("/bas/validate")
def bas_validate(): return {"ok": True, "message":"Validated draft with ATO sandbox (stub)"}

@app.post("/bas/lodge")
def bas_lodge(): return {"ok": True, "message":"Lodged to ATO sandbox (stub)"}

@app.get("/bas/preview")
def bas_preview():
    return {"period":"Q1 2025","GSTPayable": 1234.56,"PAYGW": 987.65,"Total": 2222.21}

class Settings(BaseModel):
    retentionMonths: int
    piiMask: bool

_settings = {"retentionMonths": 84, "piiMask": True}

@app.post("/settings")
def save_settings(s: Settings):
    _settings.update(s.dict()); return {"ok": True}

@app.get("/openapi.json")
def openapi_proxy():
    return app.openapi()