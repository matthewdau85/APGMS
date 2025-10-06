import { Request, Response } from "express";
import { pool } from "../index.js";
import { ensureBasTables } from "../bas/storage.js";
import {
  assertTaxType,
  normalizeDomainTotals,
  projectToLabels,
  diffTotals,
  computeNetLiability,
  coerceNumericRecord,
  buildLabelResponse,
  type TaxType
} from "../bas/labels.js";

function json(value: unknown) {
  return JSON.stringify(value);
}

export async function amendBas(req: Request, res: Response) {
  const { periodId } = req.params as { periodId: string };
  const { abn, taxType, domainTotals, submittedBy, reason, evidenceRef, nextPeriodId } = req.body || {};

  if (!abn || typeof abn !== "string") {
    return res.status(400).json({ error: "abn required" });
  }
  if (!taxType || typeof taxType !== "string") {
    return res.status(400).json({ error: "taxType required" });
  }
  if (!periodId || typeof periodId !== "string") {
    return res.status(400).json({ error: "periodId required" });
  }

  try {
    assertTaxType(taxType);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || String(err) });
  }

  try {
    await ensureBasTables(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const period = await client.query(
        `SELECT id FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId]
      );
      if (period.rowCount === 0) {
        throw new Error("PERIOD_NOT_FOUND");
      }

      const normalized = normalizeDomainTotals(taxType as TaxType, domainTotals || {});
      const labelTotals = projectToLabels(taxType as TaxType, normalized);

      const existing = await client.query(
        `SELECT revision_seq, domain_totals, label_totals, carry_forward_in, carry_forward_out
           FROM bas_period_totals
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          FOR UPDATE`,
        [abn, taxType, periodId]
      );
      const row = existing.rows[0];
      const revisionSeq = (row?.revision_seq ?? 0) + 1;
      const beforeDomain = coerceNumericRecord(row?.domain_totals);
      const beforeLabels = coerceNumericRecord(row?.label_totals);
      const carryForwardIn = row?.carry_forward_in ?? null;
      const carryForwardOut = row?.carry_forward_out ?? null;

      const domainDelta = diffTotals(beforeDomain, normalized);
      const labelDelta = diffTotals(beforeLabels, labelTotals);
      const beforeLabelView = buildLabelResponse(taxType as TaxType, beforeLabels);
      const afterLabelView = buildLabelResponse(taxType as TaxType, labelTotals);

      const netBefore = computeNetLiability(taxType as TaxType, beforeLabels);
      const netAfter = computeNetLiability(taxType as TaxType, labelTotals);
      const netDelta = netAfter - netBefore;

      const revision = await client.query(
        `INSERT INTO bas_revisions (
           abn, tax_type, period_id, revision_seq,
           submitted_by, submitted_reason, evidence_ref,
           domain_totals_before, domain_totals_after, domain_delta,
           label_totals_before, label_totals_after, label_delta,
           net_before_cents, net_after_cents, net_delta_cents
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16
         ) RETURNING revision_id, created_at`,
        [
          abn,
          taxType,
          periodId,
          revisionSeq,
          submittedBy ?? null,
          reason ?? null,
          evidenceRef ?? null,
          json(beforeDomain),
          json(normalized),
          json(domainDelta),
          json(beforeLabels),
          json(labelTotals),
          json(labelDelta),
          netBefore,
          netAfter,
          netDelta
        ]
      );

      const revisionId = revision.rows[0].revision_id as number;
      const revisionCreated = revision.rows[0].created_at as Date;

      let carryForwardOutPayload = carryForwardOut ?? null;

      if (netDelta < 0) {
        if (!nextPeriodId || typeof nextPeriodId !== "string") {
          throw new Error("NEXT_PERIOD_REQUIRED_FOR_CREDIT");
        }
        const creditAmount = Math.abs(netDelta);
        const details = {
          from_period_id: periodId,
          to_period_id: nextPeriodId,
          amount_cents: creditAmount,
          revision_id: revisionId,
          evidence_ref: evidenceRef ?? null,
          net_before_cents: netBefore,
          net_after_cents: netAfter
        };
        const carry = await client.query(
          `INSERT INTO bas_carry_forward (
             abn, tax_type, from_period_id, to_period_id,
             amount_cents, revision_id, evidence_reference, details
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
           ON CONFLICT (abn, tax_type, from_period_id, to_period_id)
           DO UPDATE SET amount_cents=EXCLUDED.amount_cents,
             revision_id=EXCLUDED.revision_id,
             evidence_reference=EXCLUDED.evidence_reference,
             details=EXCLUDED.details,
             updated_at=now()
           RETURNING carry_id`,
          [abn, taxType, periodId, nextPeriodId, creditAmount, revisionId, evidenceRef ?? null, json(details)]
        );
        const carryId = carry.rows[0].carry_id as number;
        carryForwardOutPayload = { ...details, carry_id: carryId };

        const inboundPayload = { ...details, carry_id: carryId };
        await client.query(
          `INSERT INTO bas_period_totals (abn,tax_type,period_id,domain_totals,label_totals,revision_seq,carry_forward_in,carry_forward_out)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,0,$6::jsonb,$7::jsonb)
           ON CONFLICT (abn,tax_type,period_id)
           DO UPDATE SET carry_forward_in=EXCLUDED.carry_forward_in, updated_at=now()`,
          [abn, taxType, nextPeriodId, json({}), json({}), json(inboundPayload), json(null)]
        );
      } else if (carryForwardOut) {
        const toPeriod = carryForwardOut.to_period_id ?? nextPeriodId;
        await client.query(
          `DELETE FROM bas_carry_forward WHERE abn=$1 AND tax_type=$2 AND from_period_id=$3 AND ($4::text IS NULL OR to_period_id=$4)`,
          [abn, taxType, periodId, toPeriod ?? null]
        );
        if (toPeriod) {
          await client.query(
            `UPDATE bas_period_totals SET carry_forward_in=NULL, updated_at=now()
             WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
            [abn, taxType, toPeriod]
          );
        }
        carryForwardOutPayload = null;
      }

      await client.query(
        `INSERT INTO bas_period_totals (abn,tax_type,period_id,domain_totals,label_totals,revision_seq,carry_forward_in,carry_forward_out,updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8::jsonb,now())
         ON CONFLICT (abn,tax_type,period_id)
         DO UPDATE SET domain_totals=EXCLUDED.domain_totals,
           label_totals=EXCLUDED.label_totals,
           revision_seq=EXCLUDED.revision_seq,
           carry_forward_out=EXCLUDED.carry_forward_out,
           updated_at=now()`,
        [
          abn,
          taxType,
          periodId,
          json(normalized),
          json(labelTotals),
          revisionSeq,
          json(carryForwardIn),
          json(carryForwardOutPayload)
        ]
      );

      await client.query(
        `UPDATE periods SET final_liability_cents=$1 WHERE abn=$2 AND tax_type=$3 AND period_id=$4`,
        [netAfter, abn, taxType, periodId]
      );

      const bundle = await client.query(
        `SELECT bundle_id FROM evidence_bundles WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId]
      );
      if (bundle.rowCount) {
        const payload = {
          revision_seq: revisionSeq,
          submitted_by: submittedBy ?? null,
          reason: reason ?? null,
          evidence_ref: evidenceRef ?? null,
          created_at: revisionCreated instanceof Date ? revisionCreated.toISOString() : revisionCreated,
          domain_totals: {
            before: beforeDomain,
            after: normalized,
            delta: domainDelta
          },
          label_totals: {
            before: beforeLabels,
            after: labelTotals,
            delta: labelDelta,
            before_view: beforeLabelView,
            after_view: afterLabelView,
          },
          net: {
            before_cents: netBefore,
            after_cents: netAfter,
            delta_cents: netDelta
          },
          carry_forward_out: carryForwardOutPayload
        };
        await client.query(
          `INSERT INTO evidence_addenda (bundle_id, revision_id, addendum)
           VALUES ($1,$2,$3::jsonb)
           ON CONFLICT (bundle_id, revision_id)
           DO UPDATE SET addendum=EXCLUDED.addendum, created_at=now()`,
          [bundle.rows[0].bundle_id, revisionId, json(payload)]
        );
      }

      await client.query("COMMIT");

      return res.json({
        ok: true,
        revision_id: revisionId,
        revision_seq: revisionSeq,
        net: { before_cents: netBefore, after_cents: netAfter, delta_cents: netDelta },
        domain_delta: domainDelta,
        label_delta: labelDelta,
        carry_forward_out: carryForwardOutPayload
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || String(err) });
  }
}
