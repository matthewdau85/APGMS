APGMS (Automated PAYGW & GST Management System)
==============================================
APGMS is an open-source web application that automates the calculation, securing, and remittance of PAYGW (Pay As You Go Withholding) and GST (Goods and Services Tax) obligations for Australian businesses at BAS lodgment. It integrates with payroll and point-of-sale systems, leverages designated one-way accounts for secure tax fund management, and provides compliance alerts and audit-ready reporting.

Features
--------
- **Automated PAYGW & GST Calculations** – Real-time calculation engines for PAYGW and GST based on payroll and POS data.
- **Secure Fund Management** – Supports transfers to designated one-way accounts, blocking unauthorized withdrawals.
- **BAS Lodgment Workflow** – Automates BAS-time fund transfers to the ATO with pre-lodgment verification.
- **Compliance & Alerts** – Proactive alerts for discrepancies, insufficient funds, and upcoming deadlines.
- **Audit Trail & Reporting** – Dashboard for real-time compliance monitoring and audit-ready exports.

Security Controls & DSP Compliance
----------------------------------
APGMS now enforces mandatory Digital Service Provider (DSP) controls across the stack:

1. **Managed KMS & Key Rotation**
   - RPT tokens are signed via a managed KMS (see `libs/rpt/rpt.py`).
   - Signatures carry explicit key IDs (`kid`) to allow seamless rotation.
   - Local development can provide ephemeral secrets via `APGMS_RPT_LOCAL_KEYS` while production requires `APGMS_RPT_KMS_ENDPOINT` and mTLS credentials.

2. **Transport Security**
   - All KMS and IAM calls require TLS 1.3 and mutual TLS. Both the Python signing client and the Node.js verification middleware refuse to connect without compliant certificates.
   - Set `APGMS_RPT_KMS_CLIENT_CERT`, `APGMS_RPT_KMS_CLIENT_KEY`, and (optionally) `APGMS_RPT_KMS_CA_CHAIN` for the RPT signing path.
   - Set `APGMS_IAM_CLIENT_CERT`, `APGMS_IAM_CLIENT_KEY`, and `APGMS_IAM_CA_CHAIN` (or IAM_* equivalents) for IAM dual-control checks.

3. **mTLS-backed Verification**
   - Payments service verification occurs via the remote KMS client (`apps/services/payments/src/kms/remoteKms.ts`) using an mTLS-protected HTTPS channel.
   - Default backend is `remote`; override with `KMS_BACKEND=local` only for isolated development.

4. **Multi-Factor Authentication & Separation of Duties**
   - BAS gate transitions (`/gate/transition`) now require IAM-issued MFA + dual approvals before mutating state (see `apps/services/bas-gate/main.py`).
   - Payments release endpoint (`/payAto`) executes only after IAM dual-control confirmation through middleware (`apps/services/payments/src/middleware/dualControl.ts`).

5. **Encrypted Secrets & Auditability**
   - Secrets never reside in source code; the signing key is obtained exclusively via KMS APIs.
   - Rotation windows are managed through `APGMS_RPT_TRUSTED_KIDS`, and key material can be distributed as encrypted blobs for local fallback testing.

Environment Configuration Summary
----------------------------------
| Variable | Purpose |
| --- | --- |
| `APGMS_RPT_KMS_ENDPOINT` | Base URL for the managed KMS signing service (HTTPS, TLS 1.3). |
| `APGMS_RPT_KMS_CLIENT_CERT` / `APGMS_RPT_KMS_CLIENT_KEY` | Client certificate and key for KMS mTLS. |
| `APGMS_RPT_KMS_CA_CHAIN` | Optional CA bundle for KMS trust anchoring. |
| `APGMS_RPT_ACTIVE_KID` | Active signing key ID. |
| `APGMS_RPT_TRUSTED_KIDS` | Comma-separated list of legacy key IDs accepted during rotation. |
| `APGMS_RPT_LOCAL_KEYS` | JSON mapping of `{kid: secret}` for local-only fallback. |
| `APGMS_IAM_URL` | Base URL for IAM approvals API (HTTPS, TLS 1.3). |
| `APGMS_IAM_CLIENT_CERT` / `APGMS_IAM_CLIENT_KEY` | Client certificate and key for IAM mTLS. |
| `APGMS_IAM_CA_CHAIN` | Optional CA bundle for IAM. |
| `IAM_DUAL_CONTROL_BYPASS` / `APGMS_IAM_BYPASS` | Development bypass switches (must remain disabled in production). |

Getting Started
---------------
```bash
git clone <your-repo-url>
cd apgms
npm install
npm start
```
The app will start on <http://localhost:3000>.

Build for Production
--------------------
```bash
npm run build
```

Project Structure
-----------------
```
apgms/
├── public/                # Static assets and HTML
├── src/                   # React components and APIs
├── apps/                  # Service implementations (payments, bas-gate, etc.)
├── libs/                  # Shared libraries (RPT signing, IAM client, etc.)
├── schema/                # Database and domain schemas
├── package.json
└── README.md
```

Contributing
------------
Pull requests are welcome! For major changes, please open an issue first to discuss what you’d like to change. Ensure new contributions maintain DSP compliance by:
- Using the managed KMS interfaces for any cryptographic operations.
- Preserving TLS 1.3 + mTLS when communicating with internal services.
- Enforcing IAM-backed MFA/SoD before mutating financial state.
- Documenting any new controls in this README.

License
-------
Open source under the MIT License.
