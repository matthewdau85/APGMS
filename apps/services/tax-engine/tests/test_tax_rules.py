from app.tax_rules import (
    DEFAULT_VERSION_ID,
    calc_gst,
    calc_paygw,
    calc_penalty,
    register_rates_version,
    set_active_version,
    RatesVersion,
    PaygwBracket,
    PenaltyConfig,
)


def test_paygw_bracket_boundaries():
    assert calc_paygw(1_820_000, DEFAULT_VERSION_ID) == 0
    assert calc_paygw(4_500_000, DEFAULT_VERSION_ID) == 509_200
    assert calc_paygw(12_000_000, DEFAULT_VERSION_ID) == 2_946_700
    assert calc_paygw(250_000_000, DEFAULT_VERSION_ID) > 90_000_000


def test_gst_rounding():
    assert calc_gst(10005, DEFAULT_VERSION_ID) == 1001
    assert calc_gst(10000, DEFAULT_VERSION_ID) == 1000


def test_penalty_components():
    amount = 100_000
    penalty = calc_penalty(45, amount, DEFAULT_VERSION_ID)
    # 45 days -> 2 FTL units (62600) + GIC 14400 = 77000
    assert penalty == 77_000
    penalty_cap = calc_penalty(400, amount, DEFAULT_VERSION_ID)
    assert penalty_cap == 231_500


def test_custom_version_registration():
    custom_id = "11111111-2222-3333-4444-555555555555"
    custom = RatesVersion(
        name="Test",
        effective_from="2025-01-01",
        effective_to=None,
        paygw_brackets=[PaygwBracket(0, None, 0, 1000)],
        gst_rate_basis_points=1_500,
        penalty=PenaltyConfig(
            penalty_unit_cents=10_000,
            unit_multiplier=1,
            days_per_unit=30,
            max_units=2,
            gic_daily_rate_basis_points=10,
        ),
        checksum="deadbeef",
    )
    register_rates_version(custom_id, custom)
    set_active_version(custom_id)
    assert calc_paygw(1_000_000) == 100_000
    assert calc_gst(10_000) == 1_500
    assert calc_penalty(35, 10_000) == 20_350
    set_active_version(DEFAULT_VERSION_ID)
