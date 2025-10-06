import { Pool } from "pg";
import { appendAudit } from "../audit/appendOnly";
import { ReconResult } from "../recon/compute";

const pool = new Pool();

type PeriodState = "OPEN" | "CLOSING" | "READY_RPT" | "BLOCKED" | "RELEASED" | "FINALIZED";

interface TransitionArgs {
  tenantId: string;
  taxType: string;
  periodId: string;
  result: ReconResult;
}

function determineNextState(current: PeriodState, result: ReconResult): PeriodState {
  if (current === "CLOSING") {
    return result.status === "RECON_OK" ? "READY_RPT" : "BLOCKED";
  }
  if (current === "BLOCKED" && result.status === "RECON_OK") {
    return "READY_RPT";
  }
  return current;
}

export async function applyReconGateTransition(args: TransitionArgs) {
  const { tenantId, taxType, periodId, result } = args;
  const periodQuery = await pool.query(
    "select state from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [tenantId, taxType, periodId]
  );
  const currentState = (periodQuery.rows[0]?.state ?? "OPEN") as PeriodState;
  const nextState = determineNextState(currentState, result);
  const changed = nextState !== currentState;

  if (changed) {
    await pool.query(
      "update periods set state=$1 where abn=$2 and tax_type=$3 and period_id=$4",
      [nextState, tenantId, taxType, periodId]
    );
  }

  await pool.query(
    "insert into gate_transitions(tenant_id, tax_type, period_id, previous_state, next_state, reason_codes) values ($1,$2,$3,$4,$5,$6)",
    [tenantId, taxType, periodId, currentState, nextState, result.reasons]
  );

  await appendAudit("gate", "RECON_TRANSITION", {
    tenantId,
    taxType,
    periodId,
    previous: currentState,
    next: nextState,
    reasons: result.reasons,
    status: result.status,
  });

  return { currentState, nextState, changed };
}
