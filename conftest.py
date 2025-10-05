"""Test configuration for ensuring internal Python packages are importable."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the repository root contains reusable Python packages under ``libs`` and ``libs/py-sdk``.
ROOT = Path(__file__).resolve().parent
PY_SDK = ROOT / "libs" / "py-sdk"
LIBS = ROOT / "libs"

for path in (PY_SDK, LIBS):
    if path.exists():
        sys_path = str(path)
        if sys_path not in sys.path:
            sys.path.insert(0, sys_path)
