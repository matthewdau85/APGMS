export interface NarrativeInputs {
  gateState: string;
  recon: {
    status: "OK" | "MISMATCH";
    deltas: number[];
    epsilon: number;
  };
  rpt: {
    keyId?: string;
    amountCents: number;
    rulesManifestSha?: string;
  };
  allowListOk: boolean;
  settlement?: {
    providerRef: string;
    paidAt?: string | null;
  } | null;
}

export function buildNarrative(inputs: NarrativeInputs): string {
  const parts: string[] = [];
  parts.push(`gate ${inputs.gateState}`);
  const deltaStr = inputs.recon.deltas.length
    ? inputs.recon.deltas.map((v) => (v >= 0 ? `+${v}` : `${v}`)).join("/")
    : "none";
  parts.push(`recon ${inputs.recon.status} (deltas ${deltaStr}, epsilon=${inputs.recon.epsilon})`);

  const rptBits: string[] = [];
  if (inputs.rpt.keyId) rptBits.push(`kid=${inputs.rpt.keyId}`);
  rptBits.push(`amount=${inputs.rpt.amountCents}`);
  if (inputs.rpt.rulesManifestSha) rptBits.push(`rules=${inputs.rpt.rulesManifestSha.slice(0, 12)}…`);
  parts.push(`RPT verified (${rptBits.join("/")})`);

  parts.push(inputs.allowListOk ? "allow-list OK" : "allow-list check failed");

  if (inputs.settlement) {
    const paidAt = inputs.settlement.paidAt ? new Date(inputs.settlement.paidAt).toISOString() : "pending";
    parts.push(`settlement provider_ref=${inputs.settlement.providerRef} paidAt=${paidAt}`);
  }

  return `Released because: ${parts.join('; ')}`;
}
