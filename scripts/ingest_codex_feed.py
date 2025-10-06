#!/usr/bin/env python3
"""Utility to convert docs/_codex_feed chunk exports into JSONL."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
import re
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

HEADER_PATTERN = re.compile(r"#\s*File:\s*(?P<file>.+)\s*\(part\s*(?P<part>\d+)\s*of\s*(?P<parts>\d+)\)")
CODE_FENCE = "```"


class ManifestError(RuntimeError):
    """Raised when the manifest cannot be processed."""


def parse_args(argv: Optional[Iterable[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest Codex chunked markdown exports into a JSONL knowledge base."
    )
    parser.add_argument(
        "--feed-dir",
        type=Path,
        default=Path("docs/_codex_feed"),
        help="Directory that contains chunked markdown parts and manifest files.",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Path to manifest.json. Defaults to <feed-dir>/manifest.json.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/ingested_codex_feed.jsonl"),
        help="Path to write JSONL output (one record per chunk).",
    )
    parser.add_argument(
        "--fail-on-missing",
        action="store_true",
        help="Fail if a manifest entry does not have a corresponding markdown file.",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


def load_manifest(manifest_path: Path) -> Dict[str, Dict[str, Any]]:
    if not manifest_path.exists():
        raise ManifestError(f"Manifest file not found: {manifest_path}")
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise ManifestError(f"Failed to parse manifest {manifest_path}: {exc}") from exc

    manifest: Dict[str, Dict[str, Any]] = {}
    for entry in data:
        md_path = Path(entry.get("md_path", "")).name
        if not md_path:
            raise ManifestError(f"Manifest entry missing md_path: {entry}")
        entry = dict(entry)
        entry["md_filename"] = md_path
        manifest[md_path] = entry
    return manifest


def extract_chunk_text(md_path: Path) -> Tuple[str, Optional[Dict[str, Any]]]:
    raw = md_path.read_text(encoding="utf-8-sig")
    lines = raw.splitlines()
    header_info: Optional[Dict[str, Any]] = None
    if lines:
        match = HEADER_PATTERN.match(lines[0].strip())
        if match:
            header_info = {
                "file": match.group("file"),
                "part": int(match.group("part")),
                "parts": int(match.group("parts")),
            }

    # Find the first fenced block in the document and extract its contents.
    inside = False
    chunk_lines: List[str] = []
    for line in lines[1:]:
        stripped = line.strip()
        if stripped.startswith(CODE_FENCE):
            if inside:
                break
            inside = True
            continue
        if inside:
            chunk_lines.append(line.rstrip("\r"))
    if not chunk_lines and len(lines) > 1:
        # Fallback: use everything after the header if fences are missing.
        chunk_lines = [line.rstrip("\r") for line in lines[1:]]
    chunk_text = "\n".join(chunk_lines).strip("\n\r\ufeff")
    return chunk_text, header_info


def iter_records(feed_dir: Path, manifest: Dict[str, Dict[str, Any]], *, fail_on_missing: bool) -> Iterator[Dict[str, Any]]:
    sorted_entries = sorted(manifest.values(), key=lambda item: item.get("order", 0))
    for entry in sorted_entries:
        md_filename = entry["md_filename"]
        md_path = feed_dir / md_filename
        if not md_path.exists():
            message = f"Skipping missing chunk file: {md_path}"
            if fail_on_missing:
                raise FileNotFoundError(message)
            print(message, file=sys.stderr)
            continue
        chunk_text, header = extract_chunk_text(md_path)
        record: Dict[str, Any] = {
            "chunk_id": f"{entry['file_relative']}::part{entry['part']:02d}",
            "order": entry.get("order"),
            "source_file": entry.get("file_relative"),
            "part": entry.get("part"),
            "parts": entry.get("parts"),
            "language": entry.get("language") or None,
            "chars_in_manifest": entry.get("chars"),
            "chunk_text": chunk_text,
            "chunk_chars": len(chunk_text),
            "md_file": md_filename,
        }
        if header:
            record["header_file"] = header.get("file")
            record["header_part"] = header.get("part")
            record["header_parts"] = header.get("parts")
        yield record


def write_jsonl(records: Iterable[Dict[str, Any]], output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with output_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False))
            handle.write("\n")
            count += 1
    return count


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)
    feed_dir = args.feed_dir
    manifest_path = args.manifest or (feed_dir / "manifest.json")
    manifest = load_manifest(manifest_path)
    records = list(iter_records(feed_dir, manifest, fail_on_missing=args.fail_on_missing))
    count = write_jsonl(records, args.output)
    print(f"Wrote {count} chunk(s) to {args.output}", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(main())
