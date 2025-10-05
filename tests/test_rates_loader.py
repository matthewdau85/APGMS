from datetime import date
from pathlib import Path

import pytest

from app.rates_repository import RatesRepository, ingest_csv


@pytest.fixture()
def temp_repo(tmp_path: Path) -> RatesRepository:
    storage = tmp_path / "rates.json"
    return RatesRepository(storage)


def test_ingest_csv_creates_versions(temp_repo: RatesRepository, tmp_path: Path):
    csv_content = """tax_type,period,scale_code,method,effective_from,effective_to,rounding,up_to,a,b,fixed,rate,tax_free_threshold,stsl\n""" \
        "PAYGW,weekly,TFT,formula_progressive,2024-07-01,2025-06-30,HALF_UP,359,0,0,0,,true,false\n" \
        "PAYGW,weekly,TFT,formula_progressive,2024-07-01,2025-06-30,HALF_UP,438,0.19,68,0,,true,false\n" \
        "PAYGW,weekly,TFT,formula_progressive,2024-07-01,2025-06-30,HALF_UP,999999,0.20,50,0,,true,false\n" \
        "GST,per_line,STANDARD,flat_rate,2024-07-01,,HALF_UP,,,,,0.10,,\n"
    csv_path = tmp_path / "rates.csv"
    csv_path.write_text(csv_content)

    ids = ingest_csv(csv_path, repo=temp_repo, source="test_fixture")

    assert len(ids) == 2
    assert any(id_.startswith("PAYGW-weekly") for id_ in ids)
    assert any(id_.startswith("GST-per_line") for id_ in ids)

    paygw_version = temp_repo.get_active_version("PAYGW", "weekly", as_of=date(2024, 7, 15))
    scale = temp_repo.select_scale(paygw_version, tax_free_threshold=True)
    brackets = scale["brackets"]
    assert brackets[0]["up_to"] == 359.0
    assert brackets[-1]["up_to"] == 999999.0
    assert temp_repo.compute_progressive_cents(43_800, paygw_version, scale) > 0

    gst_version = temp_repo.get_active_version("GST", "per_line", as_of=date(2024, 12, 1))
    gst_scale = temp_repo.select_scale(gst_version, code="STANDARD")
    assert temp_repo.compute_flat_rate_cents(1_000, gst_version, gst_scale) == 100
