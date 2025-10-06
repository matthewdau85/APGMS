# Error state

**Use when:** A request to our services fails and we cannot show fresh data.

**How to write it:**
- Keep the title plain and acknowledge the failure.
- Provide one or two actions the user can take right now (retry, contact support).
- Always display the API request ID so support can trace the incident.

**Component:** `ErrorState({ title?, body?, requestId, actionLabel?, onAction? })`
