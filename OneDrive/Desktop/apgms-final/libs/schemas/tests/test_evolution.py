from pathlib import Path; import json
def test_required_fields_stable():
    p = Path(__file__).resolve().parents[2]/'json'/'payroll_event.v1.json'
    sc = json.loads(p.read_text())
    assert 'employee_tax_file_number' in sc['required']
