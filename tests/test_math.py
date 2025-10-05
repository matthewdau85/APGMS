import pytest

from app.rates.mock import MockRatesPort
from app.tax_rules import gst_line_tax, paygw_weekly


@pytest.fixture(scope="module")
def mock_rates_version():
    return MockRatesPort().latest()


@pytest.mark.parametrize(
    "amount_cents, expected",
    [
        (0, 0),
        (1000, 100),  # 10% GST
        (999, 100),  # rounding check
    ],
)
def test_gst(amount_cents, expected, mock_rates_version):
    assert gst_line_tax(amount_cents, mock_rates_version, "GST") == expected


@pytest.mark.parametrize(
    "gross, expected",
    [
        (50_000, 7_500),  # 15% below bracket
        (80_000, 12_000),  # top of bracket
        (100_000, 16_000),  # 12,000 + 20% of 20,000
    ],
)
def test_paygw(gross, expected, mock_rates_version):
    assert paygw_weekly(gross, mock_rates_version) == expected
