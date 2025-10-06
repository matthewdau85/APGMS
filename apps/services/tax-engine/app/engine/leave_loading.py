"""Leave loading classification helpers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
import json

RULES_PATH = Path(__file__).resolve().parent.parent / "rules" / "leave_loading_rules.json"


class LeaveLoadingRuleError(ValueError):
    """Raised when a leave loading rule cannot be determined."""


@dataclass(frozen=True)
class LeaveLoadingRule:
    reference: str
    ote: bool
    payroll_tax: bool
    sg: Optional[bool]
    note: str
    aliases: Iterable[str]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LeaveLoadingRule":
        try:
            reference = data["reference"]
        except KeyError as exc:  # pragma: no cover - defensive
            raise LeaveLoadingRuleError("Leave loading rule requires a 'reference'") from exc
        return cls(
            reference=reference,
            ote=bool(data.get("ote", True)),
            payroll_tax=bool(data.get("payroll_tax", True)),
            sg=data.get("sg"),
            note=str(data.get("note", "")),
            aliases=tuple(data.get("aliases", [])),
        )


@dataclass(frozen=True)
class LeaveLoadingResult:
    amount_cents: int
    ote_applicable: bool
    payroll_tax_applicable: bool
    sg_applicable: bool
    evidence: str
    rule_reference: str


def _load_rules_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise LeaveLoadingRuleError(f"Leave loading rules file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_leave_loading_rules() -> Dict[str, Any]:
    """Load the leave loading rules JSON file."""

    return _load_rules_file(RULES_PATH)


def _normalise(value: str) -> str:
    return value.strip().lower()


def _find_rule(rules: Dict[str, Any], award_reference: Optional[str]) -> LeaveLoadingRule | None:
    if not award_reference:
        return None

    norm_award = _normalise(award_reference)
    for item in rules.get("rules", []):
        rule = LeaveLoadingRule.from_dict(item)
        candidates = [rule.reference, *rule.aliases]
        for candidate in candidates:
            if not candidate:
                continue
            norm_candidate = _normalise(candidate)
            if norm_award == norm_candidate or norm_candidate in norm_award:
                return rule
    return None


def classify_leave_loading(
    amount_cents: int,
    *,
    award_reference: Optional[str] = None,
    overrides: Optional[Dict[str, Optional[bool]]] = None,
    rules: Optional[Dict[str, Any]] = None,
) -> LeaveLoadingResult:
    """Determine OTE, payroll tax and SG treatment for leave loading."""

    rules_data = rules or load_leave_loading_rules()
    overrides = overrides or {}

    rule = _find_rule(rules_data, award_reference)
    default_data = rules_data.get("default", {})
    default_rule = LeaveLoadingRule(
        reference=default_data.get("reference", "default"),
        ote=bool(default_data.get("ote", True)),
        payroll_tax=bool(default_data.get("payroll_tax", True)),
        sg=default_data.get("sg"),
        note=str(default_data.get("note", "")),
        aliases=(),
    )

    applied_rule = rule or default_rule

    ote = overrides.get("ote")
    if ote is None:
        ote = applied_rule.ote

    payroll_tax = overrides.get("payroll_tax")
    if payroll_tax is None:
        payroll_tax = applied_rule.payroll_tax

    sg = overrides.get("sg")
    if sg is None:
        sg = applied_rule.sg if applied_rule.sg is not None else ote

    evidence_lines = []
    if applied_rule.note:
        evidence_lines.append(applied_rule.note)
    if award_reference:
        evidence_lines.append(f"Award reference considered: {award_reference}")
    if overrides:
        override_bits = ", ".join(
            f"{key} set to {value}" for key, value in overrides.items() if value is not None
        )
        if override_bits:
            evidence_lines.append(f"Manual overrides applied ({override_bits})")

    evidence = " ".join(evidence_lines).strip()
    if not evidence:
        evidence = "Default leave loading treatment applied"

    return LeaveLoadingResult(
        amount_cents=int(amount_cents),
        ote_applicable=bool(ote),
        payroll_tax_applicable=bool(payroll_tax),
        sg_applicable=bool(sg),
        evidence=evidence,
        rule_reference=applied_rule.reference,
    )
