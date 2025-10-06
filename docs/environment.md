# Environment configuration

This project relies on a small set of environment variables so the different
services (API, browser UI, and background workers) can discover each other
without hard-coding URLs or secrets. The backend reads variables from a
`.env.local` file at startup, while the browser bundles pick up variables with
`NEXT_PUBLIC_` prefixes at build time.

## Quick start

1. Copy the example file into place:
   ```bash
   cp .env.local.example .env.local
   ```
2. Adjust any values as needed for your environment.
3. Start the stack with the script that matches your workflow—`pnpm dev` for the
   hot-reload TypeScript server, `pnpm start` for the compiled output, or your
   preferred Docker compose target. The server automatically loads `.env.local`
   via `dotenv` and exposes browser-facing values through your build tooling.

> **Note**
> `.env.local` is ignored by git so you can safely keep machine-specific values
> without committing secrets to the repository.

## Variables

| Variable | Scope | Default | Purpose |
| --- | --- | --- | --- |
| `APP_MODE` | Server & UI | `prototype` | Enables prototype-friendly behaviour throughout the stack. Leave as `prototype` for local testing. |
| `FEATURE_SIM_OUTBOUND` | Server & UI | `true` | Keeps the outbound payments rail in simulation mode. Switch to `false` only when you have a real payments adapter wired in. |
| `RATES_VERSION` | Server & UI | `2024-25` | Identifies which PAYGW/GST rate table to display. Useful for toggling between compliance years in demos. |
| `NEXT_PUBLIC_API_BASE_URL` | Browser | `http://localhost:3000` | Base URL that the front-end uses when calling the main API. Because it is `NEXT_PUBLIC_`, it is safe for browser consumption. |
| `NEXT_PUBLIC_PAYMENTS_BASE_URL` | Browser | _(optional)_ | Override for the payments microservice. If omitted the UI falls back to the server's default (`http://localhost:3001`). |
| `JWT_SECRET` | Server | `dev-change-me` | Secret used to sign JSON Web Tokens in development. Replace with a strong secret before deploying anywhere shared. |

### Related server variables

The repository already supports the standard Postgres variables (`PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL`) plus optional
ATO/payments configuration (`RPT_ED25519_SECRET_BASE64`, etc.). Those are still
available if you need to customise the backend, but they are not required for
the basic prototype setup above.

### Verifying the configuration

Run the health endpoint after starting the stack to confirm the server picked up
your `.env.local` values:

```bash
curl http://localhost:3000/health
```

A JSON response (`{"ok": true}`) indicates the configuration loaded correctly
and the server connected to the database.
