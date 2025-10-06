from app.schedules import gst_labels


def test_gst_labels_examples():
    lines = [
        {"kind": "sale", "amount": 1100.00, "tax_code": "GST"},
        {"kind": "sale", "amount": 550.00, "tax_code": "GST_FREE"},
        {"kind": "purchase", "amount": 330.00, "tax_code": "GST"},
        {"kind": "purchase", "amount": 220.00, "tax_code": "INPUT_TAXED"},
        {"kind": "wages", "amount": 2000.00, "withheld": 350},
    ]

    labels = gst_labels(lines)
    assert labels == {"W1": 2000, "W2": 350, "1A": 110, "1B": 33}
