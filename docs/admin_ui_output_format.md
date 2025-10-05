# Admin UI Output and Operational Prompts

## Standard Output Format

Return a single JSON block that the admin UI can render, for example:

```
{
  "version_tag": "2025-10-06–1430",
  "summary": {
    "by_collection": {
      "PAYG": {"new_chunks": 412, "skipped_dupes": 37, "docs": 6},
      "GST_BAS": {"new_chunks": 188, "skipped_dupes": 12, "docs": 3},
      "PENALTIES_INTEREST": {"new_chunks": 94, "docs": 2},
      "STP_OSF": {"new_chunks": 51, "docs": 1},
      "PAYMENTS": {"new_chunks": 220, "docs": 4}
    },
    "configs_detected": [
      {"type":"payg_scales","effective_from":"2025-07-01","rows":48,"schema_ok":true},
      {"type":"stsl_scales","effective_from":"2025-09-24","rows":15,"schema_ok":true},
      {"type":"bas_label_map","schema_ok":true},
      {"type":"penalties_config","penalty_unit_cents":31300,"schema_ok":true}
    ],
    "conflicts": [
      {"collection":"PAYG","note":"Overlapping effective_from; kept 2025-09-24 as latest"}
    ],
    "validation": {"tax_regression":"pass", "min_chunk_size":"pass"},
    "publish": {"staged_index":"idx@2025-10-06–1430","alias_promoted":"prod"}
  }
}
```

## Mini Prompts

### Conflict & Adaptation

Use when new information contradicts existing guidance. Populate the template with the collection and effective dates. Required steps:

1. Keep both entries and mark the older guidance as superseded.
2. Attach `effective_to={{new_date_minus_1}}` to the older entry.
3. Re-run impacted tests:
   - PAYG: withholding test vectors.
   - GST_BAS: label totals & rounding tests.
   - Penalties: FTL step calculation and GIC/SIC daily compounding.
4. Publish if all tests pass; otherwise rollback and notify. Return a concise diff of the changes.

### Large File Handling

For files larger than 50 MB or more than 2,000 pages:

- Use streaming parsing with a 50 page window.
- Flush chunks every 10 pages and compute an `ingest_sha` per chunk.
- If the PDF text layer is missing, fall back to OCR only for pages with fewer than 30 detected characters.
- Rate-limit parsing to one request per second for external tools.
- Report progress in the format `{file, pages_done, chunks_emitted, ocr_pages}`.

### Gated or Licensed Content

If a source appears gated (login required, license headers, portal domain), pause ingestion and request operator confirmation with:

```
{ operator_confirm_rights: true, license_ref: "...", retention_policy_days: 365 }
```

If confirmation is not provided, skip those files and continue with public sources.

## Admin Panel Copy

- **Upload or Select Sources:** "Drag files/folders here or paste URLs. We support PDF, DOCX, XLSX, CSV, HTML, TXT. Large files are streamed and chunked."
- **Rights Confirmation:** "Some sources appear gated/licensed. Confirm you are authorised to ingest them."
- **Chunking Settings:** "Target ~1,200 tokens, 200 overlap (recommended)."
- **Publish Mode:** "Stage → Validate → Promote to production."
- **Release Notes:** "A version tag will be created; you can roll back anytime."
