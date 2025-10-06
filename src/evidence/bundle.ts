import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import {
  getGateRecord,
  getReconResult,
  getSettlement,
  GateRecord,
  listAuditLog,
} from "../ingest/store";

interface RulesFileDescriptor {
  name: string;
  source_url: string;
  path: string;
  effective_from: string;
  effective_to: string;
}

interface RulesManifest {
  rates_version: string;
  files: RulesFileDescriptor[];
}

async function loadRulesManifest(): Promise<RulesManifest> {
  const manifestPath = path.join(process.cwd(), "data", "rules_manifest.json");
  const content = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(content) as RulesManifest;
}

async function computeSha256(filePath: string): Promise<string> {
  const file = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(file).digest("hex");
}

async function resolveRules(manifest: RulesManifest) {
  const files = await Promise.all(
    manifest.files.map(async (file) => {
      const resolvedPath = path.join(process.cwd(), file.path);
      const sha256 = await computeSha256(resolvedPath);
      return {
        name: file.name,
        sha256,
        source_url: file.source_url,
        effective_from: file.effective_from,
        effective_to: file.effective_to,
      };
    })
  );
  return {
    rates_version: manifest.rates_version,
    files,
  };
}

function describeGatePath(gate: GateRecord): string[] {
  const path: string[] = ["OPEN"];
  gate.transitions.forEach((transition) => {
    const last = path[path.length - 1];
    if (transition.to !== last) {
      path.push(transition.to);
    }
  });
  if (path[path.length - 1] !== gate.state) {
    path.push(gate.state);
  }
  return path;
}

function buildRationale(
  periodId: string,
  gate: GateRecord,
  pathHistory: string[],
): string {
  const recon = getReconResult(periodId);
  const finalState = pathHistory[pathHistory.length - 1];
  const tolerances = `tolerance ${gate.thresholds.tolerance_pct}% with max delta ${gate.thresholds.max_delta_cents} cents`;
  const approvals = gate.approvals.map((approval) => `${approval.user}${approval.mfa ? " (MFA)" : ""}`).join(", ") || "none";
  const reconSummary = recon?.status === "RECON_OK"
    ? "reconciliation passed with no material variances"
    : `reconciliation failed due to ${recon?.reasons.map((r) => r.code).join(", ")}`;
  return `Gate traversed ${pathHistory.join(" → ")} under ${tolerances}; ${reconSummary}. Approvals recorded: ${approvals}. Final state ${finalState}.`;
}

export async function buildEvidenceBundle(periodId: string) {
  const manifest = await loadRulesManifest();
  const rules = await resolveRules(manifest);
  const gate = getGateRecord(periodId);
  const settlement = getSettlement(periodId);
  const pathHistory = describeGatePath(gate);
  const recon = getReconResult(periodId);

  const narrative = {
    gate_path: pathHistory,
    thresholds: gate.thresholds,
    anomalies: recon?.reasons.map((reason) => ({
      code: reason.code,
      desc: reason.description ?? reason.code,
      resolved: recon?.status === "RECON_OK",
    })) ?? [],
    approvals: gate.approvals,
    rationale: buildRationale(periodId, gate, pathHistory),
  };

  const settlementDetails = settlement ?? {
    periodId,
    channel: "UNKNOWN",
    provider_ref: "",
    amount_cents: 0,
    paidAt: "",
    receiptPayload: undefined,
  };

  const audit = listAuditLog().filter((entry) => entry.payload?.periodId === periodId);

  return {
    periodId,
    computedAt: new Date().toISOString(),
    details: {
      rules,
      settlement: {
        channel: settlementDetails.channel,
        provider_ref: settlementDetails.provider_ref,
        amount_cents: settlementDetails.amount_cents,
        paidAt: settlementDetails.paidAt,
        receiptPayload: settlementDetails.receiptPayload ?? null,
      },
      narrative,
      audit,
    },
  };
}
