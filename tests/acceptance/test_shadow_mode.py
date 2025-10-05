import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_shadow_mode_shadow_report():
    proc = subprocess.run(
        ["npx", "tsx", "tests/acceptance/shadow_mode_scenario.ts"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    assert lines, "expected scenario output"
    data = json.loads(lines[-1])

    assert data["shadow_records"] == data["total"] == 20
    assert data["mismatch_count"] == 5
    assert abs(data["mismatch_rate"] - 0.25) < 0.05
    assert data["ledger_rows"] == 21
    assert data["last_balance"] == 300000
