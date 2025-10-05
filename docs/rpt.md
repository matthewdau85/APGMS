# Reconciliation Pass Token (RPT) v0.1

## Overview

The RPT is a compact JSON Web Signature (JWS) issued after a BAS period successfully completes the reconciliation pass. The token conveys summary evidence for the period and is required before any payment egress can be executed.

Setting the feature flag `PROTO_ENABLE_RPT=true` enables the issuance and verification middleware in the API.

## Payload schema

The RPT payload is versioned at v0.1 and must contain the following fields:

| Field | Type | Notes |
| --- | --- | --- |
| `rpt_id` | string | Unique identifier for the token instance |
| `abn` | string | ABN of the entity |
| `bas_period` | string | BAS period identifier (e.g. `2025-09`) |
| `totals.paygw_cents` | number | PAYGW liability in cents |
| `totals.gst_cents` | number | GST liability in cents |
| `evidence_merkle_root` | string | Merkle root over OWA ledger deltas |
| `rates_version` | string | Applied rates table identifier |
| `anomaly_score` | number | Maximum absolute anomaly dimension |
| `iat` | number | Issued-at time (seconds since epoch) |
| `exp` | number | Expiry (seconds since epoch) |
| `nonce` | string | Replay-protection nonce (also used as JTI) |
| `kid` | string | Signing key identifier |

The payload is signed using EdDSA (Ed25519) and delivered as a compact JWS. Both the header and payload embed the same `kid` value.

## Signing keys and rotation

Signing keys live in `infra/kms/rpt_keys.json`. Run `pnpm rotate:rpt` (or `npx tsx scripts/rotate_rpt_key.ts`) to rotate the active key. Rotation will:

1. Generate a new Ed25519 key pair.
2. Mark the previous active key as `retired` in the keystore.
3. Update `public/.well-known/jwks.json` with the public portion of all active keys.
4. Print the new `kid` to stdout for distribution.

Services consuming the JWKS should cache keys and support key rollover.

## Verification, revocation, and anti-replay

The `requireRptForEgress` middleware guards every payment egress route. Verification performs the following checks:

1. JWS integrity using the public key identified by the `kid`.
2. Payload schema validation and expiry/issued-at bounds.
3. Anti-replay via the `rpt_jti` table (stores the nonce/JTI with its expiry).
4. Token status in `rpt_tokens` (revoked tokens are rejected).
5. Liability totals matched against the persisted period record.

Revoking a token is achieved by updating `rpt_tokens.status` to `REVOKED`. Once revoked, any subsequent egress attempt using that token will be rejected.

Expired or replayed nonces automatically fail verification. Expired JTI entries can be safely purged using routine database maintenance.

## Operational notes

* The Merkle root is recalculated from the OWA ledger when issuing a token to guarantee determinism with the stored evidence.
* The signing TTL defaults to 15 minutes and is configurable via `RPT_TTL_SECONDS`.
* All functionality is gated behind `PROTO_ENABLE_RPT`; when the flag is `false` the issuance and egress endpoints respond with `RPT_DISABLED`.
