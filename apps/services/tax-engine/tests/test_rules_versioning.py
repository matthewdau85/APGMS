from pathlib import Path

from app.rules.loader import validate_known_hashes
from app.rules.version import RATES_VERSION


def test_rules_hashes_are_current():
    mismatches = validate_known_hashes()
    assert not mismatches, "; ".join(mismatches) or "Rules hashes must match KNOWN_RULE_FILE_HASHES"


def test_changelog_mentions_current_rates_version():
    changelog = Path(__file__).resolve().parents[1] / "CHANGELOG.md"
    content = changelog.read_text("utf-8")
    assert RATES_VERSION in content, f"Add an entry for rates version {RATES_VERSION} to CHANGELOG.md"
