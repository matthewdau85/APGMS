# ML Assist Service

This workspace contains lightweight MLOps plumbing used for local development:

- A SQLite-backed feature store (`feature_store/`).
- Synthetic feature build jobs (`npm run build_features:recon`, `npm run build_features:bank`, `npm run build_features:liability`).
- A quick training pipeline (`npm run ml:train:quick`) that learns a tiny risk scoring model and registers it under `models/`.
- A drift monitor job (`npm run ml:drift:nightly`) that runs PSI checks on tracked features and records reports.

The jobs are implemented in TypeScript and executed with [`tsx`](https://github.com/esbuild-kit/tsx).
