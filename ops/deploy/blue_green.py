#!/usr/bin/env python3
"""Blue/green deployment orchestrator helpers.

This script keeps the repo-local state files in sync so that deploy
pipelines can source provider bindings, capability state, and proxy
selection from a single place.  It is intentionally file-based so it can
run in CI without extra dependencies.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import error, request

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent
STATE_PATH = SCRIPT_DIR / "state.json"
ENV_DIR = SCRIPT_DIR / "env"
ACTIVE_ENV_PATH = SCRIPT_DIR / "active.env"
PENDING_ENV_PATH = SCRIPT_DIR / "pending.env"
PREVIOUS_ENV_PATH = SCRIPT_DIR / "previous.env"
PROXY_DIR = SCRIPT_DIR / "proxy"
ACTIVE_PROXY_PATH = PROXY_DIR / "active.conf"
PORTAL_BINDINGS_PATH = ROOT / "portal-api" / "provider_bindings.json"
CAPABILITY_STATE_PATH = ROOT / "portal-api" / "capability_state.json"


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def load_state() -> Dict[str, Any]:
    if not STATE_PATH.exists():
        raise SystemExit(f"State file missing at {STATE_PATH}")
    return load_json(STATE_PATH)


def save_state(state: Dict[str, Any]) -> None:
    write_json(STATE_PATH, state)


def available_colors() -> Dict[str, Any]:
    bindings = load_json(PORTAL_BINDINGS_PATH)
    return {c.lower(): cfg for c, cfg in bindings.items()}


def env_template(color: str) -> Path:
    path = ENV_DIR / f"{color}.env"
    if not path.exists():
        raise SystemExit(f"Missing env template for color '{color}' at {path}")
    return path


def proxy_template(color: str) -> Path:
    path = PROXY_DIR / f"{color}.conf"
    if not path.exists():
        raise SystemExit(f"Missing proxy template for color '{color}' at {path}")
    return path


def update_capability(color: str, ready: bool, note: Optional[str] = None) -> None:
    state = load_json(CAPABILITY_STATE_PATH)
    entry = state.setdefault(color, {"checks": {}, "ready": False, "lastUpdated": None})
    entry["ready"] = ready
    entry["lastUpdated"] = time.time()
    if note:
        entry["note"] = note
    checks = entry.setdefault("checks", {})
    if ready:
        for check in ("api", "normalizer", "reporting"):
            checks[check] = "ready"
    else:
        for check in ("api", "normalizer", "reporting"):
            checks[check] = "provisioning"
    write_json(CAPABILITY_STATE_PATH, state)


def fetch_status(url: str) -> Dict[str, Any]:
    req = request.Request(url, headers={"Accept": "application/json"})
    with request.urlopen(req) as resp:  # type: ignore[arg-type]
        return json.loads(resp.read().decode("utf-8"))


def handle_deploy(args: argparse.Namespace) -> None:
    colors = available_colors()
    color = args.color.lower()
    if color not in colors:
        raise SystemExit(f"Unknown deploy color '{args.color}'. Known: {', '.join(colors)}")

    state = load_state()
    active_color = state.get("active_color")
    if active_color == color:
        raise SystemExit("Color already active; nothing to deploy")

    PENDING_ENV_PATH.unlink(missing_ok=True)
    shutil.copyfile(env_template(color), PENDING_ENV_PATH)
    state["previous_color"] = active_color
    state["pending_color"] = color
    save_state(state)

    update_capability(color, ready=False, note="Deployment initiated")
    print(f"Prepared deployment config for '{color}'. Pending color set.")
    print(f"Pending env -> {PENDING_ENV_PATH}")
    print("Run health checks, then mark-ready and gate when complete.")


def handle_mark_ready(args: argparse.Namespace) -> None:
    color = args.color.lower()
    colors = available_colors()
    if color not in colors:
        raise SystemExit(f"Unknown deploy color '{args.color}'.")
    update_capability(color, ready=True, note=args.note)
    print(f"Capability matrix for '{color}' marked ready.")


def handle_gate(args: argparse.Namespace) -> None:
    state = load_state()
    color = state.get("pending_color")
    if not color:
        raise SystemExit("No pending color to gate. Run deploy first.")

    if args.status_url:
        status_url = args.status_url.rstrip("/") + "/deploy/status"
        try:
            payload = fetch_status(status_url)
        except error.URLError as exc:
            raise SystemExit(f"Failed to reach status endpoint: {exc}")
        if payload.get("activeColor") != color:
            raise SystemExit(
                f"Status endpoint reports activeColor={payload.get('activeColor')} (expected {color})."
            )
        capability = payload.get("capabilityMatrix", {})
        if not capability or not capability.get("ready"):
            raise SystemExit("Capability matrix not ready per service response.")

    if not PENDING_ENV_PATH.exists():
        raise SystemExit(f"Pending env file missing at {PENDING_ENV_PATH}; run deploy first.")

    # promote pending env to active
    if ACTIVE_ENV_PATH.exists():
        shutil.copyfile(ACTIVE_ENV_PATH, PREVIOUS_ENV_PATH)
    shutil.copyfile(PENDING_ENV_PATH, ACTIVE_ENV_PATH)
    PENDING_ENV_PATH.unlink(missing_ok=True)

    # update proxy
    shutil.copyfile(proxy_template(color), ACTIVE_PROXY_PATH)

    previous = state.get("active_color")
    state["active_color"] = color
    state["proxy_color"] = color
    state["pending_color"] = None
    state["previous_color"] = previous
    save_state(state)

    update_capability(color, ready=True, note="Traffic gated to color")
    print(f"Traffic flipped to '{color}'. Previous color was '{previous}'.")


def handle_rollback(_: argparse.Namespace) -> None:
    state = load_state()
    previous = state.get("previous_color")
    if not previous:
        raise SystemExit("No previous color recorded for rollback.")
    current = state.get("active_color")
    if current == previous:
        raise SystemExit("Previous color matches current; rollback would be a no-op.")

    shutil.copyfile(env_template(previous), ACTIVE_ENV_PATH)
    shutil.copyfile(proxy_template(previous), ACTIVE_PROXY_PATH)

    state["pending_color"] = None
    state["proxy_color"] = previous
    state["active_color"] = previous
    state["previous_color"] = current
    save_state(state)

    PENDING_ENV_PATH.unlink(missing_ok=True)

    update_capability(previous, ready=True, note="Rollback executed")
    if current:
        update_capability(current, ready=False, note="Rolled back")
    print(f"Rollback complete. Active color restored to '{previous}'.")


def handle_status(_: argparse.Namespace) -> None:
    state = load_state()
    print(json.dumps(state, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Blue/green deployment helper")
    sub = parser.add_subparsers(dest="command", required=True)

    deploy = sub.add_parser("deploy", help="Prepare a color for deployment")
    deploy.add_argument("color", help="Color to deploy (blue/green)")
    deploy.set_defaults(func=handle_deploy)

    mark = sub.add_parser("mark-ready", help="Mark a color's capability matrix ready")
    mark.add_argument("color", help="Color to update")
    mark.add_argument("--note", help="Optional note for the capability matrix entry")
    mark.set_defaults(func=handle_mark_ready)

    gate = sub.add_parser("gate", help="Flip traffic once readiness is confirmed")
    gate.add_argument("--status-url", help="Portal API base URL to validate readiness")
    gate.set_defaults(func=handle_gate)

    rollback = sub.add_parser("rollback", help="Rollback to the previous active color")
    rollback.set_defaults(func=handle_rollback)

    status = sub.add_parser("status", help="Show current deployment state")
    status.set_defaults(func=handle_status)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
