from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_rates_manifest_includes_version():
    resp = client.get("/tax/rates")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rates_version"] == "2024-25"
    assert body["manifest"]["rates_version"] == "2024-25"


def test_paygw_calc_returns_period_notice():
    payload = {"gross": 2000, "period": "weekly", "method": "formula_progressive"}
    resp = client.post("/tax/paygw/calc", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["rates_version"] == "2024-25"
    notice = data["period_notice"]
    assert notice["rates_version"] == "2024-25"
    assert "withholding" in data["result"]
