import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_rules_drift.py"
RULES_DIR = Path(__file__).resolve().parents[1] / "app" / "rules"
CHECKSUMS = RULES_DIR / "checksums.json"


@pytest.mark.parametrize("args,expected_rc", [([], 0)])
def test_check_rules_drift_happy_path(args, expected_rc):
    result = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
    assert result.returncode == expected_rc, result.stderr
    assert "All rule checksums" in result.stdout


def test_check_rules_drift_detects_differences(tmp_path):
    working_rules = tmp_path / "rules"
    shutil.copytree(RULES_DIR, working_rules)
    target = working_rules / "payg_w_2024_25.json"
    data = json.loads(target.read_text(encoding="utf-8-sig"))
    data["notes"] = "test modification"
    target.write_text(json.dumps(data, indent=2), encoding="utf-8")

    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--rules-dir",
            str(working_rules),
            "--checksums",
            str(CHECKSUMS),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "sha256 drift" in result.stderr
