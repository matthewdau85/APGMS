# Runtime configuration

The server supports layered configuration with the following precedence:

1. Environment variables
2. Profile file (`config/<profile>.yaml`)
3. Defaults (`config/default.yaml`)

`APP_PROFILE` selects which profile file to load. If it is unset the loader falls back to the `dev` profile.

## Provider endpoints

| Key | Description | Default profile value |
| --- | --- | --- |
| `providers.bank` | Banking rails adapter endpoint | `https://bank.example.internal` |
| `providers.kms` | KMS / secrets provider endpoint | `https://kms.example.internal` |
| `providers.rates` | FX rate provider endpoint | `https://rates.example.internal` |
| `providers.idp` | Identity provider endpoint | `https://idp.example.internal` |
| `providers.statements` | Statement retrieval endpoint | `https://statements.example.internal` |

Override any provider endpoint with one of the following environment variables:

- `PROVIDERS_BANK`
- `PROVIDERS_KMS`
- `PROVIDERS_RATES`
- `PROVIDERS_IDP`
- `PROVIDERS_STATEMENTS`

The legacy alias `BANK_PROVIDER` is also honored for the banking provider.

## Global flags

| Flag | Type | Purpose |
| --- | --- | --- |
| `PROTO_KILL_SWITCH` | boolean | Hard-disables prototype features when set to `true`. |
| `SHADOW_MODE` | boolean | Enables dual-write/monitor-only flows without impacting production systems. |
| `TZ` | string | Forces the process timezone when the OS environment does not provide one. |
| `MOCK_*` | boolean/string | Any flag beginning with `MOCK_` is captured and exposed to the application for mock integrations. |

Boolean flags accept `true/false`, `1/0`, `yes/no`, or `on/off` (case insensitive).

## Profiles

- `config/dev.yaml`: local development defaults (localhost providers, mocks enabled, shadow mode on).
- `config/stage.yaml`: staging defaults (stage endpoints, mocks disabled, shadow mode on).
- `config/prod.yaml`: production defaults (production endpoints, all mocks disabled).

Use `make profile-dev` or `make profile-prod` to export an appropriate `APP_PROFILE` together with commonly used overrides for the current shell session.
