# Anomaly vector contract

The reconciliation and issuer services both derive risk decisions from a shared
"anomaly vector" that describes period level telemetry. The vector is a JSON
object with the following canonical keys:

| Key | Description |
| --- | --- |
| `variance_ratio` | Rolling variance of lodgements compared to the long term baseline. |
| `dup_rate` | Estimated duplicate remittance rate within the period. |
| `gap_minutes` | Largest observed gap between expected settlement events. |
| `delta_vs_baseline` | Relative delta between the current liability and the long term median. |

Every key should be present even when the underlying metric is zero so that
both services can apply the same deterministic comparison rules. The issuer
uses these fields with the thresholds in
`src/anomaly/deterministic.ts` to determine whether a period should be blocked
(`BLOCKED_ANOMALY`) or allowed to continue (`READY_RPT`).

If additional anomaly dimensions are introduced they must be added to this
contract and implemented in both reconciliation and issuer code paths so the
decision logic remains aligned.
