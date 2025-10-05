from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_payg_w_endpoint_liability_matches_withheld():
    payload = {
        "payg_w": {
            "period": "weekly",
            "gross": 1500.0,
            "tax_free_threshold": True,
        },
        "tax_withheld": 280.0,
        "deductions": 10.0,
    }
    resp = client.post("/calculate/payg-w", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["withholding"] == 302.85
    assert data["liability"] == 12.85


def test_payg_w_endpoint_stsl_flag():
    payload = {
        "payg_w": {
            "period": "weekly",
            "gross": 2000.0,
            "stsl": True,
        }
    }
    resp = client.post("/calculate/payg-w", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["withholding"] == 562.85


def test_gst_endpoint():
    resp = client.post("/calculate/gst", json={"amount": 440.0})
    assert resp.status_code == 200
    assert resp.json()["gst"] == 44.0


def test_penalties_endpoint():
    resp = client.post("/calculate/penalties", json={"amount": 5000.0, "daysLate": 14})
    assert resp.status_code == 200
    assert resp.json()["penalty"] == 19.96
