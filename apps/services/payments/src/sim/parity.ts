// apps/services/payments/src/sim/parity.ts
import { sendEftOrBpay } from '../bank/eftBpayAdapter.js';
import { sha256Hex } from '../utils/crypto.js';

export type ParitySimConfig = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  idempotencyKey: string;
  destination: {
    bpay_biller?: string;
    crn?: string;
    bsb?: string;
    acct?: string;
  };
  gateState: string;
  kid: string;
};

export type ParityReconResult = {
  provider_ref: string;
  settlement_amount_cents: number;
  manifest_sha256: string;
  gate_state: string;
  kid: string;
};

export type ParityEvidence = {
  settlement: {
    provider_ref: string;
    amount_cents: number;
    bank_receipt_hash: string;
  };
  rules: {
    manifest_sha256: string;
  };
  narrative: string[];
};

export type ParitySimResult = {
  release: {
    provider_ref: string;
    transfer_uuid: string;
    bank_receipt_hash: string;
    amount_cents: number;
  };
  recon: ParityReconResult;
  evidence: ParityEvidence;
};

export async function runParitySimulation(config: ParitySimConfig): Promise<ParitySimResult> {
  const transfer = await sendEftOrBpay({
    abn: config.abn,
    taxType: config.taxType,
    periodId: config.periodId,
    amount_cents: config.amount_cents,
    destination: config.destination,
    idempotencyKey: config.idempotencyKey,
  });

  const providerRef = transfer.provider_receipt_id;
  const manifestInput = {
    abn: config.abn,
    taxType: config.taxType,
    periodId: config.periodId,
    gateState: config.gateState,
    kid: config.kid,
    providerRef,
  };
  const manifestSha = sha256Hex(JSON.stringify(manifestInput));

  const recon: ParityReconResult = {
    provider_ref: providerRef,
    settlement_amount_cents: config.amount_cents,
    manifest_sha256: manifestSha,
    gate_state: config.gateState,
    kid: config.kid,
  };

  const evidence: ParityEvidence = {
    settlement: {
      provider_ref: providerRef,
      amount_cents: config.amount_cents,
      bank_receipt_hash: transfer.bank_receipt_hash,
    },
    rules: { manifest_sha256: manifestSha },
    narrative: [`gate_state:${config.gateState}`, `kid:${config.kid}`],
  };

  return {
    release: {
      provider_ref: providerRef,
      transfer_uuid: transfer.transfer_uuid,
      bank_receipt_hash: transfer.bank_receipt_hash,
      amount_cents: config.amount_cents,
    },
    recon,
    evidence,
  };
}
