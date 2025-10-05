import pytest

from app.rates.mock import MockRatesPort
from app.tax_rules import gst_line_tax, paygw_weekly


@pytest.fixture(scope="module")
def mock_rates_version():
    return MockRatesPort().latest()


def test_gst_line_tax(mock_rates_version):
    assert gst_line_tax(10000, mock_rates_version, "GST") == 1000
    assert gst_line_tax(10000, mock_rates_version, "GST_FREE") == 0


def test_paygw_weekly(mock_rates_version):
    assert paygw_weekly(50000, mock_rates_version) == 7500
    assert paygw_weekly(100000, mock_rates_version) > 15000
