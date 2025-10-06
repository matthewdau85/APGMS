# Feature Store

The feature store uses a local SQLite database (`store.sqlite`) driven through the `sqlite3` CLI to persist feature sets.

Each build job writes JSON blobs per `(entity_id, as_of)` row into the `feature_data` table.
The training and monitoring jobs pivot these JSON blobs into model-ready matrices.

Generated artifacts are ignored via `.gitignore` so local experimentation does not pollute Git history.
