from app.schedules import payg_withholding


def test_payg_zero_threshold():
    assert payg_withholding(300.0) == 0


def test_payg_middle_bracket():
    # Weekly gross $800 → 0.16 * 800 - 56 = $72 (ATO rounding)
    assert payg_withholding(800.0) == 72


def test_payg_upper_bracket_rounding():
    # Weekly gross $1,500 → 0.30 * 1500 - 177.153846 ≈ 272.846 → $273
    assert payg_withholding(1500.0) == 273


def test_payg_with_stsl():
    # Adds STSL at 2% above $102 threshold
    base = payg_withholding(1000.0, stsl=False)
    with_stsl = payg_withholding(1000.0, stsl=True)
    # (1000-102)*0.02 = 17.96 → $18 after ATO rounding
    assert with_stsl == base + 18
