SHELL := /bin/bash

up:
	@docker compose up -d --build --remove-orphans

up-dev:
	@docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --build --remove-orphans

down:
	@docker compose down -v

logs:
	@docker compose logs -f normalizer

shell:
	@docker compose exec normalizer /bin/sh -lc 'whoami && python --version && pip list'

rebuild:
	@docker compose build --no-cache normalizer && $(MAKE) up

ps:
	@docker compose ps

fmt:
        @echo "No formatter configured; add ruff/black if desired."

profile-dev:
	@echo "export APP_PROFILE=dev"
	@echo "export SHADOW_MODE=true"
	@echo "export PROTO_KILL_SWITCH=false"
	@echo "export TZ=UTC"
	@echo "export MOCK_BANK=true"
	@echo "export MOCK_KMS=true"
	@echo "export MOCK_RATES=true"
	@echo "export MOCK_IDP=true"
	@echo "export MOCK_STATEMENTS=true"
	@echo "# eval \$$(make profile-dev) to apply in your shell"

profile-prod:
	@echo "export APP_PROFILE=prod"
	@echo "export SHADOW_MODE=false"
	@echo "export PROTO_KILL_SWITCH=false"
	@echo "export TZ=UTC"
	@echo "export MOCK_BANK=false"
	@echo "export MOCK_KMS=false"
	@echo "export MOCK_RATES=false"
	@echo "export MOCK_IDP=false"
	@echo "export MOCK_STATEMENTS=false"
	@echo "# eval \$$(make profile-prod) to apply in your shell"