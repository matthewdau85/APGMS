# APGMS Payment Rails Consent

Before we move funds over live payment rails, we need your explicit confirmation that:

1. You understand the prototype will initiate real debits and credits on behalf of the business when live mode is enabled.
2. You agree that test transactions may appear on bank statements and that you are responsible for reconciling them.
3. You acknowledge that safeguards (thresholds, allow lists, and anomaly checks) have been reviewed and are acceptable for your use case.
4. You consent to audit logging of every release, including the operator account that triggered it.

**By enabling live rails you confirm the above and authorise APGMS to execute payments using your configured banking credentials.**

Record the operator name or email, the time consent was provided, and store this confirmation before setting `RAILS_MODE=real`.
