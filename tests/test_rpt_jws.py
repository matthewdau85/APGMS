import pytest

from libs.rpt import ReplayError, build, verify

_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDKSe9QJ0XXczeroGVFRN9xy7IWaED1VYKD8xLNWoxvawaru6FMHKkqzdnq/Jmc3qFYnw7zvViQO7/6
jH6u0HN/O7KCZI2mQmzNPMNEcibjloM01ZISDkpoVDMyeoPxuqtl/zyNYz82KyqZM2sGDXo0JgyWt+yMc+jbvhJyGODy6gO+u82Tqg8KET24VpUu6KONbUg/9e37MzKy
84LGEoaMb0ws+kY6JQs6f895NIuOA8i87i1S8N1Spv+e1uvjbf2Tbgexeo2MX9QwcECAOmXpkJzl+pxst6DKe67JYN9RVj22Bm9oAerW8cS7iBdXUMbEezzkk6buH4Af
uums/A6HAgMBAAECggEASLBPl6g9DwG+X+QXb9AjUJNG74lPyjiLWRm3yGXAr+qv73bRK3XjDdgBddCF7FoNdThWmZwQ3mcyAXiJrwyFbBNJ/lPemH8m9IrgidBRDBfS
FuKlhepvr1SOPxXKIssWeuS/3/hpRvA08u8IhpjCMEn53RDDJecipg+DNk+dSXvMDaE69Cyf05Dwf7q5SYaV8JvLtOfgSzYD98BPeJ01YwxC/sY0Q5exWC0j49DEwQ2O
MKGWZ29IiKHvt6h3pHlY8VnVTHDhA0b1YlnhCcFLiqkRiNVluUb8xh/oWZu2ph+f7MzFcflA8o8vk3zvUpzKDLhekqIJMUKkZ4DbmLyJnQKBgQD929mw6GOcLBPOMgA+
VglX5hRwp4K9LT34ide73j9vv8QmUfaNVZuia8ZVxjqkLg94WFWioguJ4Tgl6wKExs1T3Txz3ldrt5ziVgmoYI4aCi3H1VCewUnoI7FfYOFHKvcPU6K/l+XQ/unTqILb
YC1NSsUEi3dDMkM9wfDweCaCJQKBgQDL/rsfjQKgU5CWH/W4WW+qG3XGzxXWD2xoCDi3xNc0IDrrCJ7Xb6vrT9o+lEaKp6upkaFXWpHDWOG+oiK2UQeuIkidxh+AeEpANhpwzCTs7wRXhS1Yu1SFvL9FcIf71g5TAjQBUEBrvvNpLtgL9bPR0PSkXAoUave9FvrMV4bQOwKBgFKPZ7MTQSIPa7mJpW6giJVfrJIeyHRB/H+SROlClJsBYQedbHP2vZELQAuxVm0C1eEryV4FGX+UEbCzR7Rq+2gk8X41d3T+2DT8ClQKYuyxFsaA56FZ93FZ+luspFeC76q6ZpmtCv73iJBfo385PkJ+6Khbu0PNWvUA2B081jlJAoGAGkrv1WY4Y2/B4AeohSVJ5jP53zEL0HZWc6YzoUQGtNo+ndKTnpLvJro5F/3GhdKMpqN1lyu+Q95t4kNFlBgnlEMo9uT1ZHqcn2AZ0lYNoFhCSAGLUbd7cm1cfde+PzBc0kgjadPtKbYH65O1Fv2JOs7i6VhPmEgdPEr88l+JqccCgYAPEpkTVx0uHkx6HEgu8D7qM3RwKivcSOb+dXilrEp1x+96tzWK0MKTqlSyNeyx3ZiI3UI/grw1WMS5E9VZevGS7xjyN2oUdQ7H2p7HJZ6rW3STZgTlrdZywQ3B7X3fEHg1LK5/aIyW/zUCcYJp1e41Tr8MdUNh1PhtJFZ5/L5xUQ==
-----END PRIVATE KEY-----"""

_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyknvUCdF13M3q6BlRUTfccuyFmhA9VWCg/MSzVqMb2sGq7uhTBypKs3Z6vyZnN6hWJ8O871YkDu/+ox+rtBz
fzuygmSNpkJszTzDRHIm45aDNNWSEg5KaFQzMnqD8bqrZf88jWM/NisqmTNrBg16NCYMlrfsjHPo274Schjg8uoDvrvNk6oPChE9uFaVLuijjW1IP/Xt+zMysvOCxhKG
jG9MLPpGOiULOn/PeTSLjgPIvO4tUvDdUqb/ntbr4239k24HsXqNjF/UMHBAgDpl6ZCc5fqcbLegynuuyWDfUVY9tgZvaAHq1vHEu4gXV1DGxHs85JOm7h+AH7rprPwO
hwIDAQAB
-----END PUBLIC KEY-----"""


def _install_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APGMS_RPT_PRIVATE_KEY_PEM", _PRIVATE_KEY)
    monkeypatch.setenv("APGMS_RPT_PUBLIC_KEY_PEM", _PUBLIC_KEY)
    # reset cached keys between tests
    from libs.rpt import rpt as module  # local import to avoid circulars

    module._private_key = None
    module._public_key = None


def test_golden_compact_jws(monkeypatch: pytest.MonkeyPatch):
    _install_keys(monkeypatch)
    result = build(
        period_id="2025-Q4",
        paygw_total=1234.56,
        gst_total=789.01,
        source_digests={"payroll": "b3ab7e", "pos": "6be231"},
        anomaly_score=0.17,
        rates_version="2025-10",
        evidence_root="abc123def",
        ttl_seconds=600,
        kid="rpt-key-1",
        nonce="deadbeefcafebabe",
        iat=1_700_000_000,
        exp=1_700_000_600,
        jti="rpt-jti-0001",
    )
    token = result["token"]
    assert token  # sanity
    assert result["claims"]["evidence_root"] == "abc123def"
    # Expected token filled after first run
    assert token == GOLDEN_JWS


def test_replayed_jti_rejected(monkeypatch: pytest.MonkeyPatch):
    _install_keys(monkeypatch)
    token = build(
        period_id="2025-Q4",
        paygw_total=10.0,
        gst_total=5.0,
        source_digests={"payroll": "aaa"},
        anomaly_score=0.0,
        rates_version="2025-10",
        evidence_root="root",
        ttl_seconds=600,
        nonce="cafefeed",
        iat=1_700_000_000,
        exp=1_700_000_600,
        jti="rpt-jti-0002",
    )["token"]

    seen: set[str] = set()

    def remember(jti: str, _exp_dt) -> bool:
        if jti in seen:
            return False
        seen.add(jti)
        return True

    payload = verify(token, jti_store=remember, now=1_700_000_100)
    assert payload["jti"] == "rpt-jti-0002"

    with pytest.raises(ReplayError):
        verify(token, jti_store=remember, now=1_700_000_100)


# Golden token asserted by the test for deterministic signing output.
GOLDEN_JWS = "".join([
    "eyJhbGciOiJSUzI1NiIsImtpZCI6InJwdC1rZXktMSIsInR5cCI6IkpXVCJ9.",
    "eyJhbm9tYWx5X3Njb3JlIjowLjE3LCJldmlkZW5jZV9yb290IjoiYWJjMTIzZGVmIiwiZXhwIjoxNzAwMDAwNjAwLCJnc3RfdG90YWwiOjc4OS4wMSwiaWF0IjoxNzAwMDAwMDAwLCJqdGkiOiJycHQtanRpLTAwMDEiLCJub25jZSI6ImRlYWRiZWVmY2FmZWJhYmUiLCJwYXlnd190b3RhbCI6MTIzNC41NiwicGVyaW9kX2lkIjoiMjAyNS1RNCIsInJhdGVzX3ZlcnNpb24iOiIyMDI1LTEwIiwic291cmNlX2RpZ2VzdHMiOnsicGF5cm9sbCI6ImIzYWI3ZSIsInBvcyI6IjZiZTIzMSJ9LCJ0eXBlIjoiQVBHTVNfUlBUIn0.",
    "f-r5aipaUqLVxHnuU0srWQyA0PUfZX2CKD2pzJrkMbPvoAfzCv9IL0dtaQ6JFiqWpxPXZvPAcvj9Ivqd9RAb_rHCAbqjSRCps3a6HGyQ9VDzQ52HYMUTjuS9zSZMLR3viGmES_pgByjGRLliPdoM6vmmUIKQq6uAi52OXTLQS1-SSkwJgMzNDGxQ2wIj5_2Hu7D-pFfd3RbOUMGwNSa0bdoTrKnYacqH-3LzKugylR9X2Q3RZ0lVJQDvMgZ0UmjZtjz2X_wKnz3pGFhNXzo6lyFLNseuQ3hfqf8VSsGJmOXz0y_IO0zahUOyOZFxvXbCxuZ4GsNOO1AsYcJSz10saw",
])
