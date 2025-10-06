export type ComplianceStatus = "pass" | "fail" | "warn";

export interface ComplianceResult {
  id: string;
  control: string;
  requirement: string;
  status: ComplianceStatus;
  detail: string;
}

const results: ComplianceResult[] = [];

function assertEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    results.push({
      id: `env:${name.toLowerCase()}`,
      control: "Configuration",
      requirement: `Environment variable ${name} must be set`,
      status: "fail",
      detail: `${name} is required for compliance but is not configured.`,
    });
    return undefined;
  }
  return value;
}

export function runComplianceChecks(): ComplianceResult[] {
  results.length = 0;

  const residency = assertEnv("DATA_RESIDENCY_REGION");
  if (residency) {
    const allowed = ["au-southeast-2", "australia-southeast1", "ap-southeast-2"];
    const status: ComplianceStatus = allowed.includes(residency.toLowerCase()) ? "pass" : "warn";
    results.push({
      id: "dsp:data-residency",
      control: "ATO DSP 2.2",
      requirement: "Production data must remain within Australian regions",
      status,
      detail: status === "pass"
        ? `Region ${residency} accepted as Australian residency.`
        : `Region ${residency} is not in the allow list. Review residency controls.`,
    });
  }

  const retentionRaw = assertEnv("AUDIT_LOG_RETENTION_DAYS");
  if (retentionRaw) {
    const days = Number(retentionRaw);
    const meets = Number.isFinite(days) && days >= 2555; // 7 years
    results.push({
      id: "dsp:audit-retention",
      control: "ATO DSP 5.4",
      requirement: "Retain audit logs for minimum 7 years",
      status: meets ? "pass" : "fail",
      detail: meets
        ? `Retention configured for ${days} days.`
        : `Retention of ${retentionRaw} days is below 7 year requirement.`,
    });
  }

  const tlsKey = process.env.TLS_KEY_PATH;
  const tlsCert = process.env.TLS_CERT_PATH;
  results.push({
    id: "dsp:transport-security",
    control: "ATO DSP 4.1",
    requirement: "All external services enforce TLS termination",
    status: tlsKey && tlsCert ? "pass" : "warn",
    detail: tlsKey && tlsCert
      ? "TLS key/certificate paths configured."
      : "TLS not fully configured. Set TLS_KEY_PATH and TLS_CERT_PATH.",
  });

  const sod = process.env.SOD_ENFORCEMENT === "true";
  results.push({
    id: "dsp:sod",
    control: "ATO DSP 3.3",
    requirement: "Separation of duties enforced for issuance vs release",
    status: sod ? "pass" : "warn",
    detail: sod
      ? "SOD enforcement flag enabled; runtime routes reject same-actor release."
      : "SOD enforcement flag not set; runtime enforcement still applied per request but flag documents acceptance.",
  });

  return results.slice();
}

export function getComplianceResults(): ComplianceResult[] {
  return results.slice();
}
