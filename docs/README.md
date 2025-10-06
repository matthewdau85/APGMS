# APGMS

Skeleton monorepo for Automated PAYGW & GST Management System.

See ADRs in `/docs/adr` and architecture diagrams in Mermaid in `/docs/diagrams`.

## Chunked document ingestion

The repository includes a large `_codex_feed` export under `docs/_codex_feed`.
Use the helper script below to turn those markdown parts into a JSONL knowledge
base that other tooling can consume:

```bash
python scripts/ingest_codex_feed.py \
  --feed-dir docs/_codex_feed \
  --output docs/ingested_codex_feed.jsonl
```

By default the script reads `manifest.json` in the feed directory to preserve
the original ordering and part metadata. Pass `--fail-on-missing` to surface an
error if any manifest entry is missing a corresponding markdown chunk.
