# Provider Adapter Architecture

This service now uses a provider/adapter registry so the platform team can swap real SDKs
for mocks or alternative implementations without touching business logic.

## Configuration

Set the `PROVIDERS` environment variable to map each provider domain to an implementation.
The format is `key=value` pairs separated by semicolons. Supported keys are `bank`, `kms`,
`rates`, `idp` (alias for identity), `identity`, `anomaly`, and `statements`.

```bash
PROVIDERS="bank=mock;kms=mock;rates=mock;idp=dev;statements=mock"
```

Optional settings:

- `PROVIDERS_SHADOW` enables shadow mode. Provide the same syntax as `PROVIDERS` to define
  a secondary provider that is invoked asynchronously on every call. Any shadow failures
  are logged and do not impact the primary result.
- `PROVIDER_KILL_SWITCHES` accepts a comma or semicolon separated list of providers to
  disable entirely (for example `PROVIDER_KILL_SWITCHES="bank"`). Calls to a killed provider
  throw `ProviderKillSwitchError`.
- `RPT_SIGNING_KEY_ALIAS` overrides the alias used when asking the KMS provider to sign an
  RPT payload. The default alias is `RPT_ED25519_SECRET`, which maps to the environment
  variable `RPT_ED25519_SECRET_BASE64` when the `env` KMS provider is active.

## Provider Registry

All business logic imports interfaces from `@core/ports` and obtains implementations via
`providerRegistry.get(<provider>)`. Concrete SDKs are only referenced inside provider
factories located under `src/core/providers/*`.

Default primary providers:

| Domain      | Provider      |
| ----------- | ------------- |
| bank        | `postgres`    |
| kms         | `env`         |
| rates       | `static`      |
| identity    | `dev`         |
| anomaly     | `deterministic` |
| statements  | `local`       |

The registry applies kill switches before invocation and wraps each provider in a proxy that
forwards calls to the configured shadow implementation when present.

## Contract Tests

Run `npm run provider:contracts` (or `pnpm provider:contracts` / `pnpm test`) to execute the Node.js contract test suite. The
suite runs the same expectations against both the mock and real adapters for each provider
family, guaranteeing interface compatibility.

## Make/PowerShell helpers

- `make provider-contracts` — executes the provider contract suite.
- `./Run-ProviderContracts.ps1` — Windows-friendly PowerShell wrapper.
