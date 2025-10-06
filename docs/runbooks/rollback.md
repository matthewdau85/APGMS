# Blue/Green Rollback Runbook

This runbook covers the exact commands to execute when rolling back a
blue/green deployment of the portal stack.

## Preconditions

* The deployment state files in `ops/deploy/` are up to date. In
  particular `state.json` should show the current `active_color` and the
  `previous_color` that was just replaced.
* The blue/green helper script and Make targets have been committed.

## Steps

1. **Confirm current state** (optional but recommended):

   ```bash
   ./ops/deploy/blue_green.py status
   ```

   Verify that `previous_color` points to the color you intend to roll
   back to.

2. **Flip traffic and provider bindings back in one step**:

   ```bash
   make rollback
   ```

   This command performs the following actions atomically:

   * Restores `ops/deploy/active.env` from the recorded `previous_color`
     template so the provider bindings and `DEPLOY_COLOR` match the prior
     release.
   * Rewrites `ops/deploy/proxy/active.conf` to point the proxy at the
     previous color.
   * Updates `ops/deploy/state.json` so `active_color`, `proxy_color`, and
     `previous_color` reflect the rollback.
   * Marks the capability matrix in
     `portal-api/capability_state.json` as `ready` for the restored color
     and `rolled back` for the color that was removed.

3. **Validate** the system after rollback by checking the deployment
   status endpoint. Point the request at the stack that should now be
   live (for example, the blue pool):

   ```bash
   curl -s https://portal.example.internal/deploy/status | jq .
   ```

4. **(Optional) Clean up** any failed pending deployment metadata:

   ```bash
   rm -f ops/deploy/pending.env
   ```

   The rollback command already deletes stale pending data, so this is
   only necessary if additional files were created outside the helper
   script.

## Notes

* `make rollback` will exit non-zero if there is no recorded
  `previous_color`. Ensure `make gate` (or `./ops/deploy/blue_green.py
  gate`) was executed before attempting to roll back.
* The runbook assumes the portal API is reachable at
  `https://portal.example.internal`. Adjust the validation command to the
  correct host as needed.
