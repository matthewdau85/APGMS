# Loading state

**Use when:** Data is in-flight and we expect a fast response (<5 seconds).

**How to write it:**
- Label what we are doing ("Loading GST ledger" > "Loading...").
- Avoid blocking the whole screen if secondary tasks are available.
- Transition to success, empty or error states immediately once the request settles.

**Component:** `LoadingState({ label })`
