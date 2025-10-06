from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts/rules/guard.ts"


def run_guard(*args: str) -> subprocess.CompletedProcess[str]:
    cmd = ["npx", "tsx", str(SCRIPT), "--simulate", *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_rules_change_requires_version_bump() -> None:
    result = run_guard(
        "--changed",
        "apps/services/tax-engine/app/rules/payg_w_2024_25.json",
        "--version-before",
        "2024.10.05.0",
        "--version-after",
        "2024.10.05.0",
        "--changelog-changed",
        "false",
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "RATES_VERSION" in (result.stderr + result.stdout)
