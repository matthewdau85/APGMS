# Tax rules current state

The PAYG-W rules are generated from curated inputs in `scripts/rules/data` and published in the
`apps/services/tax-engine/app/rules` directory. Automation keeps the JSON canonical and produces a
manifest that downstream services can verify.

## SHA-256 manifest

| Rule file | SHA-256 | Last reviewed | Source |
| --- | --- | --- | --- |
| `payg_w_2024_25.json` | `45543a98f56c39c207f32cd3535f58695525c91700e04bd1ee0cee18676b4d9a` | 2024-10-01 | [ATO weekly tax table](https://www.ato.gov.au/rates/tax-tables/weekly-tax-table) |

Manifest generated at: 2025-10-06T09:25:44.312Z.

## How updates are promoted

1. Run `npm run rules:fetch` to regenerate rule JSON from the curated sources.
2. Run `npm run rules:hash` to update `rules_manifest.json` with the latest SHA-256 digests.
3. Bump `RATES_VERSION` in `apps/services/tax-engine/app/rules/version.py` and add a matching entry to `CHANGELOG.md`.
4. Commit changes and open a pull request. CI runs `npm run rules:verify` to block missing version or changelog updates.
5. Nightly automation should execute `npm run rules:fetch` and raise an issue if git reports differences.
