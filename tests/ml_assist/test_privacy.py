import os
import json
import hmac
import hashlib
import sys
from importlib import reload
from pathlib import Path
from typing import Tuple

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _b64url(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _make_token(secret: str, scopes) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {"scope": " ".join(scopes)}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = _b64url(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


@pytest.fixture()
def client(tmp_path, monkeypatch) -> Tuple[TestClient, object]:
    monkeypatch.setenv("ML_PII_HASH_SALT", "unit-test-salt")
    monkeypatch.setenv("APP_SECRETS_KMS_KEY", "unit-test-master-key")
    monkeypatch.setenv("APP_JWT_SECRET", "unit-test-jwt-secret")
    monkeypatch.setenv("ML_STORE_PATH", str(tmp_path / "ml_store.enc"))

    from apps.services.ml_assist import security as security_module
    from apps.services.ml_assist import store as store_module

    security_module.get_hash_salt.cache_clear()
    security_module.get_cipher.cache_clear()
    security_module.get_jwt_secret.cache_clear()
    store_module.get_store.cache_clear()

    from apps.services.ml_assist import main as main_module

    reload(main_module)
    return TestClient(main_module.app), main_module


def test_ingest_hashes_pii_and_encrypts_store(client):
    test_client, module = client
    ingest_token = _make_token("unit-test-jwt-secret", ["ml:ingest"])

    payload = {
        "document_id": "doc-123",
        "ocr_text": "Invoice: INV-001\nABN: 53004085616\nTotal: 1234.56",
        "identifiers": {"abn": "53004085616", "contact": "alice@example.com"},
        "structured_fields": {"invoice_number": "INV-001"},
        "metadata": {"uploader": "alice@example.com", "batch": 7},
    }

    response = test_client.post(
        "/ml/ingest",
        json=payload,
        headers={"Authorization": f"Bearer {ingest_token}"},
    )

    assert response.status_code == 200
    record = module.store.get("doc-123")
    assert record is not None
    assert record["identifiers_hashed"]["abn"] != "53004085616"
    assert record["identifiers_hashed"]["contact"] != "alice@example.com"
    assert record["structured_hashed"]["invoice_number"] != "INV-001"
    assert "ocr_text" not in record

    store_path = Path(os.environ["ML_STORE_PATH"])
    assert store_path.exists()
    ciphertext = store_path.read_bytes()
    assert b"53004085616" not in ciphertext
    assert b"alice@example.com" not in ciphertext


def test_ml_read_scope_required(client):
    test_client, _module = client
    ingest_token = _make_token("unit-test-jwt-secret", ["ml:ingest"])
    read_token = _make_token("unit-test-jwt-secret", ["ml:read"])

    payload = {
        "document_id": "doc-401",
        "ocr_text": "Name: Bob\nTotal: 88.20",
        "identifiers": {"customer_id": "123-456"},
    }

    resp = test_client.post(
        "/ml/ingest",
        json=payload,
        headers={"Authorization": f"Bearer {ingest_token}"},
    )
    assert resp.status_code == 200

    resp_forbidden = test_client.get(
        "/ml/artifacts",
        headers={"Authorization": f"Bearer {ingest_token}"},
    )
    assert resp_forbidden.status_code == 403

    resp_ok = test_client.get(
        "/ml/artifacts",
        headers={"Authorization": f"Bearer {read_token}"},
    )
    assert resp_ok.status_code == 200
    data = resp_ok.json()
    assert data["count"] >= 1
    assert any(item["document_id"] == "doc-401" for item in data["items"])
