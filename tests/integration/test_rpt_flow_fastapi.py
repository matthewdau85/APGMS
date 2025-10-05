import json
import subprocess
import time
from pathlib import Path

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
NODE_RUNNER = PROJECT_ROOT / "tests" / "integration" / "mock_server_runner.cjs"


def start_mock_server():
    proc = subprocess.Popen(
        ["node", str(NODE_RUNNER)],
        cwd=PROJECT_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    base_url = None
    start_time = time.time()
    while time.time() - start_time < 5:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.1)
            continue
        line = line.strip()
        try:
            data = json.loads(line)
            base_url = data["baseUrl"]
            break
        except json.JSONDecodeError:
            continue
    if not base_url:
        stderr = proc.stderr.read()
        proc.terminate()
        raise RuntimeError(f"Failed to start mock server: {stderr}")
    return proc, base_url


def stop_mock_server(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_fastapi_rpt_flow_integration():
    proc, base_url = start_mock_server()
    try:
        # Ensure the Node server is ready
        for _ in range(10):
            try:
                httpx.get(f"{base_url}/health", timeout=1.0)
                break
            except httpx.RequestError:
                time.sleep(0.1)
        app = FastAPI()

        @app.post("/rpt-flow")
        def orchestrate():
            issue = httpx.post(
                f"{base_url}/rpt/issue",
                json={"abn": "12345678901", "taxType": "GST", "periodId": "2025-09"},
                timeout=2.0,
            ).json()
            release = httpx.post(
                f"{base_url}/release",
                json={"abn": "12345678901", "taxType": "GST", "periodId": "2025-09"},
                timeout=2.0,
            ).json()
            evidence = httpx.get(
                f"{base_url}/evidence",
                params={"abn": "12345678901", "taxType": "GST", "periodId": "2025-09"},
                timeout=2.0,
            ).json()
            return {"issue": issue, "release": release, "evidence": evidence}

        client = TestClient(app)
        resp = client.post("/rpt-flow")
        assert resp.status_code == 200
        data = resp.json()
        assert data["release"]["released"] is True
        assert data["release"]["new_balance"] == 0
        assert data["evidence"]["period"]["state"] == "RELEASED"
        assert len(data["evidence"]["owa_ledger"]) == 2
    finally:
        stop_mock_server(proc)
