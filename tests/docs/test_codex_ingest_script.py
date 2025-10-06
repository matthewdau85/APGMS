from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def _make_manifest_entry(md_filename: str, order: int = 1) -> dict:
    return {
        "order": order,
        "file_relative": "sample.txt",
        "part": 1,
        "parts": 1,
        "md_path": str(Path("C:/tmp") / md_filename),
        "language": "",
        "chars": 12,
    }


def test_ingest_script_generates_jsonl(tmp_path: Path) -> None:
    feed_dir = tmp_path / "_codex_feed"
    feed_dir.mkdir()
    md_filename = "0001_sample.txt_part_01of01.md"
    manifest_path = feed_dir / "manifest.json"
    manifest_path.write_text(json.dumps([_make_manifest_entry(md_filename)]), encoding="utf-8")

    chunk_content = "# File: sample.txt (part 1 of 1)\n```\nHello world\n```\n"
    (feed_dir / md_filename).write_text(chunk_content, encoding="utf-8")

    output_path = tmp_path / "out.jsonl"
    repo_root = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [
            sys.executable,
            "scripts/ingest_codex_feed.py",
            "--feed-dir",
            str(feed_dir),
            "--manifest",
            str(manifest_path),
            "--output",
            str(output_path),
        ],
        cwd=repo_root,
        check=True,
        capture_output=True,
        text=True,
    )

    assert "Wrote 1 chunk" in result.stderr

    lines = output_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert payload["chunk_text"] == "Hello world"
    assert payload["chunk_id"] == "sample.txt::part01"
    assert payload["chunk_chars"] == len("Hello world")
