# Operator Prompt Templates

This document captures the standardized prompts operators can use when issuing high-level instructions to the APGMS assistants. Each template includes the relevant metadata and task list that downstream agents expect.

## Admin → Ingestion

Use this template when the admin uploads or references source files for ingestion into the system.

```
Action: Ingest
Operator: {{name}}
Confirm rights for gated/licensed content: {{true|false}}

Sources:
{{list of file paths or URLs}}

Collections (if known): {{PAYG|GST_BAS|PENALTIES_INTEREST|STP_OSF|PAYMENTS|AUTO}}

Constraints:
- target_tokens={{1200}}, overlap={{200}}
- max_file_bytes={{50MB}}
- ocr={{auto|force|off}}

Tasks:
1) Parse each source with the right parser (use OCR if unreadable).
2) Normalize text (strip boilerplate; keep tables).
3) Chunk with given sizes and overlaps.
4) Classify into collections if AUTO.
5) Deduplicate by ingest_sha; stage new/changed chunks.
6) Detect/validate structured configs (PAYG/STSL/BAS/penalties). If valid, write to config and stage.
7) Run validations + tax-regression tests.
8) If all pass, publish to prod (promote staged index; tag version).
9) Return a release note summarizing:
   - counts by collection,
   - new vs skipped (dedupe),
   - detected configs + effective dates,
   - known conflicts and resolutions,
   - version tag promoted.
```

Fill placeholders in double braces with the specific details for the current ingestion run before dispatching the prompt.
