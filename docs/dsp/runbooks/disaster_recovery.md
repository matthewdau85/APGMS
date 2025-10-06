# Disaster Recovery Runbook

## Objective
Restore critical APGMS services following a catastrophic infrastructure failure within Recovery Time Objective (RTO) of 8 hours and Recovery Point Objective (RPO) of 15 minutes.

## Scope
- Production workloads in primary AWS region (ap-southeast-2).
- Supporting services: databases, object storage, compute clusters, CI/CD pipelines, secrets management.

## Preconditions
- Daily infrastructure-as-code (IaC) backups stored in secure artifact repository.
- Automated database snapshots every 15 minutes with cross-region replication.
- Runbook owner: Platform Lead.

## Recovery Steps
1. **Activation Criteria**
   - Primary region outage lasting >30 minutes.
   - Data corruption or loss that cannot be remediated in-place.
   - Executive decision following SEV0/1 incident.
2. **Initial Actions (0-30 minutes)**
   - Convene DR bridge with Platform Lead (IC), Security Lead, Engineering Manager, and Communications Lead.
   - Assess blast radius, confirm RTO/RPO feasibility, and decide on regional failover.
3. **Environment Provisioning (30-120 minutes)**
   - Deploy baseline infrastructure stack using Terraform to secondary region (ap-southeast-1).
   - Restore secrets from AWS Secrets Manager backup, rotate master credentials.
   - Provision CI/CD runners and validate connectivity to source control.
4. **Data Restoration (120-240 minutes)**
   - Promote latest replicated database snapshot; verify integrity via checksum scripts.
   - Restore object storage buckets from replicated copies; validate evidence archives.
   - Reconfigure KMS keys and update application configuration with new ARNs.
5. **Application Bring-Up (240-360 minutes)**
   - Deploy application services from latest approved release tag.
   - Execute smoke tests covering authentication, payment workflow, and reporting dashboards.
   - Enable monitoring dashboards and alerting in secondary region.
6. **Customer Communication (parallel)**
   - Provide hourly updates to customers via status page and email.
   - Issue post-incident summary within 48 hours outlining impact, duration, and remediation.
7. **Repatriation to Primary Region**
   - After primary region restored, schedule migration window.
   - Sync data back, perform validation, and switch traffic.

## Validation & Testing
- Semi-annual full DR simulation involving failover to secondary region.
- Quarterly spot tests restoring database snapshots to staging environment.
- Test results recorded in compliance evidence register.

## Post-Event Review
- Document lessons learned and control improvements.
- Update runbook and IaC templates as required.
- Provide report to DSP compliance forum.
