#!/usr/bin/env python3
"""Rules ingestion helper.

Reads PAYGW/GST rule files, validates minimal metadata, and
produces human-readable diffs against a comparison ref.  Designed to
support CI workflows so that new rules can be reviewed and approved
without shipping new application builds.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULES_DIR = REPO_ROOT / "apps" / "services" / "tax-engine" / "app" / "rules"


@dataclass
class RuleFile:
    path: Path
    version: str
    period: Optional[str]
    text: str


def _read_json(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path} is not valid JSON: {exc}")


def _normalized_dump(data: dict) -> str:
    return json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def load_rule_file(path: Path) -> RuleFile:
    data = _read_json(path)
    version = str(data.get("version")) if "version" in data else ""
    period = data.get("formula_progressive", {}).get("period")
    if not version:
        raise SystemExit(f"{path} missing required 'version' field")
    normalized = _normalized_dump(data)
    return RuleFile(path=path, version=version, period=period, text=normalized)


def git_show(path: Path, ref: str) -> Optional[str]:
    try:
        result = subprocess.run(
            ["git", "show", f"{ref}:{path.as_posix()}"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError:
        return None
    return result.stdout.decode("utf-8-sig")


def list_changed_rules(compare_ref: Optional[str], rules_dir: Path) -> List[Path]:
    paths: List[Path] = []
    if compare_ref:
        proc = subprocess.run(
            ["git", "diff", "--name-only", compare_ref, "--", str(rules_dir)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for line in proc.stdout.decode().splitlines():
            p = (REPO_ROOT / line.strip()).resolve()
            if p.is_file():
                paths.append(p)
    else:
        proc = subprocess.run(
            ["git", "status", "--porcelain", "--", str(rules_dir)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for line in proc.stdout.decode().splitlines():
            candidate = line[3:].strip()
            p = (REPO_ROOT / candidate).resolve()
            if p.is_file():
                paths.append(p)
    seen = set()
    unique: List[Path] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def build_diff(current: RuleFile, previous_text: Optional[str]) -> str:
    import difflib

    prev = previous_text if previous_text is not None else ""
    diff = difflib.unified_diff(
        prev.splitlines(keepends=True),
        current.text.splitlines(keepends=True),
        fromfile=f"a/{current.path.relative_to(REPO_ROOT)}",
        tofile=f"b/{current.path.relative_to(REPO_ROOT)}",
    )
    return "".join(diff)


def write_outputs(
    files: Sequence[RuleFile],
    diffs: Sequence[str],
    output_path: Optional[Path],
    summary_path: Optional[Path],
) -> None:
    if output_path:
        output_path.write_text("\n\n".join(diffs), encoding="utf-8")
    if summary_path:
        summary = {
            "rules": [
                {
                    "path": str(r.path.relative_to(REPO_ROOT)),
                    "version": r.version,
                    "period": r.period,
                }
                for r in files
            ]
        }
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def render_console_summary(files: Sequence[RuleFile]) -> str:
    lines = ["Detected rule changes:"]
    for r in files:
        period = f" (period={r.period})" if r.period else ""
        lines.append(f" • {r.path.relative_to(REPO_ROOT)} → version {r.version}{period}")
    return "\n".join(lines)


def validate_versions(files: Sequence[RuleFile]) -> None:
    seen = {}
    for r in files:
        key = (r.path.name.split(".")[0], r.version)
        if key in seen:
            raise SystemExit(f"Duplicate version {r.version} for {r.path.name} (also in {seen[key]})")
        seen[key] = r.path


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and diff PAYGW/GST rule files")
    parser.add_argument("--rules-dir", type=Path, default=DEFAULT_RULES_DIR, help="Directory containing rule JSON files")
    parser.add_argument("--compare-ref", help="Git ref to compare against (default: staged working tree)")
    parser.add_argument("--output", type=Path, help="Where to write the unified diff")
    parser.add_argument("--summary-json", type=Path, help="Where to write a machine-readable summary")
    parser.add_argument("--fail-on-empty", action="store_true", help="Exit with code 1 when no rule changes detected")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    rules_dir: Path = args.rules_dir if args.rules_dir.is_absolute() else (REPO_ROOT / args.rules_dir)
    if not rules_dir.exists():
        raise SystemExit(f"Rules directory {rules_dir} does not exist")

    changed = list_changed_rules(args.compare_ref, rules_dir)
    if not changed:
        message = "No rule changes detected"
        print(message)
        return 1 if args.fail_on_empty else 0

    rule_files: List[RuleFile] = []
    diffs: List[str] = []
    for path in changed:
        rule = load_rule_file(path)
        previous_text = None
        if args.compare_ref:
            previous_text = git_show(path, args.compare_ref)
        else:
            previous_text = git_show(path, "HEAD")
        diff = build_diff(rule, previous_text)
        rule_files.append(rule)
        diffs.append(diff or f"No diff for {path.relative_to(REPO_ROOT)} (new file?)\n")

    validate_versions(rule_files)
    write_outputs(rule_files, diffs, args.output, args.summary_json)
    print(render_console_summary(rule_files))
    return 0


if __name__ == "__main__":
    sys.exit(main())
