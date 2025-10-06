# Privacy Impact Assessment Summary

**Solution status:** Prototype – personal information handling controls are in validation and subject to change before production release.

## Overview
APGMS processes payroll, PAYGW, and GST remittance data provided by participating employers. The system currently operates in a controlled sandbox with synthetic or consented pilot data while accreditation tasks are underway.

## Data Inventory
- Employee identifiers (name, TFN surrogate, payroll identifiers)
- Employer contact information and banking details
- Payroll amounts, PAYGW calculations, GST obligations, lodgment history

## Collection & Use
Data is collected from employer source systems through secure API uploads. It is used to simulate withholding calculations, remittance scheduling, and BAS preparation workflows for evaluation purposes.

## Storage & Security
Sandbox infrastructure uses encrypted storage and isolated network segments. Access is restricted to the delivery team under least-privilege roles. Production-grade key management and monitoring will be activated once DSP accreditation is achieved.

## Privacy Risks & Mitigations
| Risk | Current Mitigation | Planned Enhancement |
| --- | --- | --- |
| Unauthorized access to pilot data | Role-based access and environment segregation | Roll out centralized identity with conditional access policies |
| Data retention beyond evaluation needs | Manual retention reviews prior to quarterly clean-up | Automate retention with policy enforcement jobs and evidence logging |
| Inaccurate consent tracking | Pilot agreements stored with project governance records | Integrate consent registry API and automate participant notifications |

## Next Steps
- Finalize records of processing for DSP submission
- Complete privacy training for support staff
- Update assessment once the platform transitions into accredited production mode
