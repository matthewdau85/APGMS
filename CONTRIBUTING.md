# Contributing

Thank you for taking the time to improve APGMS! This project currently focuses on
maintaining the tax calculation rules that power the tax engine. Please follow
the guidelines below when proposing a change.

## Working with tax rules

- Authoritative rule payloads live in `apps/services/tax-engine/app/rules/`.
- Whenever a rule file changes you **must** update both `RATES_VERSION` and the
  top-level `CHANGELOG.md` with a note that describes the change.
- A CI guard enforces this policy. Run `npm run lint` locally to invoke the
  guard before you push your changes.
- Use `npm run hash:rules` (or `python scripts/hash_rules.py`) to regenerate the
  SHA-256 fingerprints that we publish in the documentation and evidence bundle.

## Submitting changes

1. Create a branch for your work.
2. Run any relevant checks (for example `npm run lint`).
3. Open a pull request with a clear description of what changed and why.
4. Ensure that documentation and evidence files stay up to date.

We appreciate detailed PR descriptions and testing notes—it helps reviewers
understand the impact of your change more quickly.
