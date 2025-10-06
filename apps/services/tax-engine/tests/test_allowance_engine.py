from app.engine.allowances import (
    load_allowance_rules,
    cents_per_km_allowance,
    benchmark_allowance,
)


def test_cents_per_km_above_cap():
    rules = load_allowance_rules("2024_25")
    result = cents_per_km_allowance(6500, 95, tier="car", rules=rules)
    assert result.claimed_cents == 617500
    assert result.exempt_cents == 425000
    assert result.taxable_cents == 192500
    assert result.stp_category == "CentsPerKilometre.Car"
    assert any("first" in note for note in result.notes)


def test_benchmark_meal_remote_taxable_excess():
    rules = load_allowance_rules("2024_25")
    result = benchmark_allowance(
        "meal", 4000, tier="standard", location="remote", rules=rules
    )
    assert result.exempt_cents == 3600
    assert result.taxable_cents == 400
    assert result.stp_category == "OvertimeMeal"


def test_benchmark_tool_within_cap():
    rules = load_allowance_rules("2024_25")
    result = benchmark_allowance(
        "tool", 1300, tier="standard", location="metro", rules=rules
    )
    assert result.exempt_cents == 1300
    assert result.taxable_cents == 0
    assert result.stp_category == "ToolAllowance"
