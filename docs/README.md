# APGMS Documentation

Skeleton monorepo for the Automated PAYGW & GST Management System (APGMS).

- Architecture Decision Records live in [`/docs/adr`](./adr).
- Architecture diagrams are expressed in Mermaid within [`/docs/diagrams`](./diagrams).
- **Digital Service Provider (DSP) Evidence**: EVTE operational artifacts are published under [`/docs/dsp`](./dsp).
  - Compliance proofs endpoint: `GET /ops/compliance/proofs` (see [`controls_matrix.md`](./dsp/controls_matrix.md)).
  - Daily compliance artifact emitted by the `compliance:daily` GitHub Action captures metrics snapshots, access review status, IR/DR drill dates, and pentest evidence.

Auditors can follow the [EVTE Acceptance Checklist](./dsp/evte_checklist.md) to validate live proof of practice.
