#!/usr/bin/env python3
import importlib.util
import json
import pathlib
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
APP_PATH = REPO_ROOT / "portal-api" / "app.py"
OUTPUT_PATH = REPO_ROOT / "api" / "openapi.json"

if not APP_PATH.exists():
    print(f"FastAPI app not found at {APP_PATH}", file=sys.stderr)
    sys.exit(1)

spec = importlib.util.spec_from_file_location("portal_api_app", APP_PATH)
if spec is None or spec.loader is None:
    print("Unable to load FastAPI application module", file=sys.stderr)
    sys.exit(1)

module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)  # type: ignore[arg-type]

app = getattr(module, "app", None)
if app is None:
    print("Module does not expose an 'app' object", file=sys.stderr)
    sys.exit(1)

openapi = app.openapi()
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUTPUT_PATH.write_text(json.dumps(openapi, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"OpenAPI schema written to {OUTPUT_PATH}")
