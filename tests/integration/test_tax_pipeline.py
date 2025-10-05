import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import process_normalized_event
from app.domains import payg_w as payg_w_mod
from apps.services.recon.main import TaxSummary, OwaSnapshot, ReconReq, evaluate_recon
from libs.rpt import rpt


def _load_paygw_rules():
    rules_path = "apps/services/tax-engine/app/rules/payg_w_2024_25.json"
    with open(rules_path, "r", encoding="utf-8-sig") as fh:
        return json.load(fh)


@pytest.fixture(scope="module")
def paygw_rules():
    return _load_paygw_rules()


@pytest.fixture
def sample_event():
    return {
        "id": "evt-001",
        "entity": "12345678901",
        "period": "2025-09",
        "payg_w": {
            "method": "formula_progressive",
            "period": "weekly",
            "gross": 2000.0,
            "tax_free_threshold": True,
        },
        "lines": [
            {"sku": "POS-1", "qty": 10, "unit_price_cents": 5000, "tax_code": "GST"},
            {"sku": "POS-2", "qty": 4, "unit_price_cents": 2500, "tax_code": "GST_FREE"},
        ],
    }


@pytest.fixture
def expected_payg(paygw_rules, sample_event):
    result = payg_w_mod.compute({"payg_w": sample_event["payg_w"]}, paygw_rules)
    return float(result["withholding"])


def test_pipeline_produces_authoritative_totals(sample_event, expected_payg):
    tax_out = process_normalized_event(sample_event)

    assert pytest.approx(tax_out["paygw_total"], rel=1e-6) == round(expected_payg, 2)

    gst_lines = sample_event["lines"][0]
    taxable_sales = (gst_lines["qty"] * gst_lines["unit_price_cents"]) / 100
    assert pytest.approx(tax_out["gst_total"], rel=1e-6) == round(taxable_sales * 0.10, 2)

    assert tax_out["source_digests"].keys() >= {"payroll", "pos"}
    assert 0.0 <= tax_out["anomaly"]["score"] <= 1.0

    recon_req = ReconReq(
        period_id=sample_event["period"],
        tax=TaxSummary(
            paygw_total=tax_out["paygw_total"],
            gst_total=tax_out["gst_total"],
            anomaly_score=tax_out["anomaly"]["score"],
            metrics=tax_out["anomaly"]["metrics"],
        ),
        owa=OwaSnapshot(paygw=tax_out["paygw_total"], gst=tax_out["gst_total"]),
    )
    recon = evaluate_recon(recon_req)
    assert recon["pass"] is True
    assert recon["reason_code"] is None
    assert recon["next_state"] == "RPT-Issued"
    assert recon["metrics"] == tax_out["anomaly"]["metrics"]

    rpt_token = rpt.build(
        sample_event["period"],
        tax_out["paygw_total"],
        tax_out["gst_total"],
        tax_out["source_digests"],
        tax_out["anomaly"]["score"],
        tax_out["anomaly"]["metrics"],
    )
    payload = {k: v for k, v in rpt_token.items() if k != "signature"}
    assert rpt.verify(payload, rpt_token["signature"]) is True
    assert payload["anomaly_metrics"] == tax_out["anomaly"]["metrics"]


def test_recon_reason_codes_when_mismatched(sample_event):
    tax_summary = TaxSummary(
        paygw_total=200.0,
        gst_total=50.0,
        anomaly_score=0.95,
        metrics={"paygw_ratio": 0.1},
    )
    owa = OwaSnapshot(paygw=150.0, gst=60.0)
    recon = evaluate_recon(ReconReq(period_id="2025-09", tax=tax_summary, owa=owa))
    assert recon["pass"] is False
    assert recon["next_state"] == "Blocked"
    assert "ANOMALY_BREACH" in recon["reason_code"]
    assert "PAYGW_EXCESS" in recon["reason_code"]
    assert "GST_SHORTFALL" in recon["reason_code"]
