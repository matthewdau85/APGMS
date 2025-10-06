from hypothesis import given, strategies as st

from app.money import from_cents, to_cents


def generate_balanced_ledger(credit_cents: list[int], debit_seeds: list[int]):
    credits = [from_cents(v) for v in credit_cents if v > 0]
    total = sum(credit_cents)
    debits: list[int] = []
    remaining = total
    for seed in (v for v in debit_seeds if v > 0):
        if remaining <= 0:
            break
        take = min(seed, remaining)
        debits.append(take)
        remaining -= take
    if remaining > 0:
        debits.append(remaining)
    debit_entries = [from_cents(v) for v in debits]
    return credits, debit_entries


@given(
    st.lists(st.integers(min_value=1, max_value=500_000), min_size=1, max_size=8),
    st.lists(st.integers(min_value=1, max_value=500_000), min_size=1, max_size=8),
)
def test_generated_ledgers_balance(credit_values, debit_seeds):
    credits, debits = generate_balanced_ledger(credit_values, debit_seeds)
    assert sum(credit_values) == sum(to_cents(d) for d in debits)
    assert sum(to_cents(c) for c in credits) == sum(to_cents(d) for d in debits)
