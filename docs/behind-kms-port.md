# Behind `KmsPort`

## Implementations

- **`kms/mock`**
  - Maintains signing keys in memory.
  - Exposes a rotation endpoint for exercising key rollover in development.
  - Publishes a development JWKS for local consumers.
- **`kms/real`**
  - Delegates signing and rotation to the cloud KMS or HSM provider.
  - Uses the provider's API for key rotation instead of an application endpoint.
  - Serves the JWKS out of the signed store used in production.

## Shared contract

- Both adapters emit key IDs using the format `app:env:date:rand`.
- Signing always uses the `RS256` algorithm so consumers receive a consistent signature type.

## External dependencies

- The anti-replay store that tracks recent signatures lives outside the adapter layer and is shared by every backend, so changing providers does not require touching it.

## Contract tests

Automated tests assert the common behavior across implementations:

1. Sign/verify round-trip succeeds for each backend.
2. Rotation window logic behaves the same regardless of provider.
3. Signatures stay within the established size limits.
