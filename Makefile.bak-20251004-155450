.PHONY: bootstrap test compose-up

bootstrap:
	@echo [bootstrap] Python venv + Poetry + deps
	@powershell -NoProfile -Command "if (!(Test-Path .venv)) { python -m venv .venv }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; python -m pip install -U pip; pip install poetry"
	@echo [bootstrap] Install service deps
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path apps\\services\\event-normalizer\\pyproject.toml) { cd apps\\services\\event-normalizer; poetry install }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path apps\\services\\tax-engine\\pyproject.toml) { cd apps\\services\\tax-engine; poetry install }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path libs\\py-sdk\\pyproject.toml) { cd libs\\py-sdk; poetry install }"
	@echo [bootstrap] Codegen
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path libs\\schemas\\codegen\\generate.py) { python libs/schemas/codegen/generate.py }"
	@echo [bootstrap] Done

test:
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path libs\\py-sdk) { cd libs\\py-sdk; poetry run pytest -q }"
	@powershell -NoProfile -Command ".\\.venv\\Scripts\\Activate.ps1; if (Test-Path apps\\services\\tax-engine) { cd apps\\services\\tax-engine; poetry run pytest -q }"

compose-up:
	@echo [compose] Bringing up containers (requires Docker Desktop running)...
	@docker compose up -d --build || (echo "Docker not running? Open Docker Desktop and retry 'make compose-up'." & exit /b 0)
	@echo Services:
	@echo  - http://localhost:8001/healthz (normalizer)
	@echo  - http://localhost:8002/healthz (tax-engine)
	@echo  - http://localhost:3000       (Grafana admin/admin)
