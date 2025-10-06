#!/usr/bin/env python3
"""Check ATO rule payloads for drift relative to authoritative checksums."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple

HERE = Path(__file__).resolve().parent
DEFAULT_RULES_DIR = HERE.parent / "app" / "rules"
DEFAULT_CHECKSUMS_FILE = DEFAULT_RULES_DIR / "checksums.json"


def _load_json(path: Path) -> Dict[str, object]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _load_rule_json(path: Path) -> Dict[str, object]:
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_authoritative(args: argparse.Namespace) -> Dict[str, Dict[str, object]]:
    if args.authoritative_file:
        return _load_json(Path(args.authoritative_file))
    if args.authoritative_url:
        try:
            import httpx  # type: ignore
        except Exception as exc:  # pragma: no cover - optional dependency
            raise SystemExit(f"httpx is required to fetch {args.authoritative_url}: {exc}") from exc
        resp = httpx.get(args.authoritative_url, timeout=30)
        resp.raise_for_status()
        return resp.json()
    return _load_json(args.checksums)


def check_rules(
    rules_dir: Path,
    authoritative: Dict[str, Dict[str, object]],
) -> Tuple[bool, str]:
    failures: list[str] = []
    for filename, meta in sorted(authoritative.items()):
        rule_path = rules_dir / filename
        if not rule_path.exists():
            failures.append(f"Missing rule file: {filename}")
            continue
        expected_sha = str(meta.get("sha256", ""))
        computed_sha = _file_sha256(rule_path)
        data = _load_rule_json(rule_path)
        local_version = str(data.get("version", ""))
        expected_version = str(meta.get("version", ""))
        if expected_version and local_version != expected_version:
            failures.append(
                f"{filename}: version mismatch (expected {expected_version}, found {local_version})"
            )
        if expected_sha and computed_sha != expected_sha:
            failures.append(
                f"{filename}: sha256 drift (expected {expected_sha}, found {computed_sha})"
            )
    ok = not failures
    message = "\n".join(failures) if failures else "All rule checksums match authoritative sources."
    return ok, message


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rules-dir", type=Path, default=DEFAULT_RULES_DIR)
    parser.add_argument("--checksums", type=Path, default=DEFAULT_CHECKSUMS_FILE)
    parser.add_argument("--authoritative-file", type=Path)
    parser.add_argument("--authoritative-url", type=str)
    parser.add_argument("--issue-path", type=Path)
    args = parser.parse_args(list(argv) if argv is not None else None)

    authoritative = _load_authoritative(args)
    ok, message = check_rules(args.rules_dir, authoritative)
    if not ok:
        if args.issue_path:
            issue_body = "# Tax rule drift detected\n\n" + message + "\n"
            args.issue_path.write_text(issue_body, encoding="utf-8")
        print(message, file=sys.stderr)
        return 1
    print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
