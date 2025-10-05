import pytest

from app.tax_rules import gst_line_tax, paygw_weekly, penalty_general_interest

@pytest.mark.parametrize(
    "amount_cents, tax_code, expected",
    [
        (0, "GST", 0),
        (1000, "GST", 100),
        (1000, "GST_FREE", 0),
    ],
)
def test_gst_line_tax(amount_cents, tax_code, expected):
    assert gst_line_tax(amount_cents, tax_code) == expected

@pytest.mark.parametrize(
    "gross_cents, expected_cents",
    [
        (150_000, 30_285),  # $1,500 weekly earnings, TFT claimed
        (200_000, 46_285),  # $2,000 weekly, no TFT (second employer)
    ],
)
def test_paygw_weekly_scales(gross_cents, expected_cents):
    if gross_cents == 200_000:
        observed = paygw_weekly(gross_cents, tax_free_threshold=False)
    else:
        observed = paygw_weekly(gross_cents)
    assert observed == expected_cents

def test_paygw_weekly_stsl_loading():
    base = paygw_weekly(200_000)
    with_stsl = paygw_weekly(200_000, stsl=True)
    # STSL adds the 5% repayment band for $2,000 weekly ($104k annually)
    assert with_stsl - base == 10_000

@pytest.mark.parametrize(
    "amount, days, expected",
    [
        (0, 10, 0.0),
        (1_000, 7, 1.99),
        (5_000, 30, 42.88),
    ],
)
def test_penalty_general_interest(amount, days, expected):
    penalty = penalty_general_interest(amount, days)
    assert pytest.approx(penalty, rel=1e-3) == expected
