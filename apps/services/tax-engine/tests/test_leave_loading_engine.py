from app.engine.leave_loading import (
    load_leave_loading_rules,
    classify_leave_loading,
)


def test_leave_loading_default_rule():
    rules = load_leave_loading_rules()
    result = classify_leave_loading(100_00, award_reference=None, rules=rules)
    assert result.ote_applicable is True
    assert result.payroll_tax_applicable is True
    assert result.sg_applicable is True
    assert "Default" in result.evidence or "Default" in result.rule_reference.capitalize()


def test_leave_loading_non_ote_rule():
    rules = load_leave_loading_rules()
    result = classify_leave_loading(200_00, award_reference="legacy-non-ote", rules=rules)
    assert result.ote_applicable is False
    assert result.payroll_tax_applicable is False
    assert result.sg_applicable is False
    assert "Legacy" in result.evidence


def test_leave_loading_sg_override():
    rules = load_leave_loading_rules()
    result = classify_leave_loading(300_00, award_reference="qld-state-award", rules=rules)
    assert result.ote_applicable is False
    assert result.payroll_tax_applicable is True
    assert result.sg_applicable is True
    assert "Queensland" in result.evidence
