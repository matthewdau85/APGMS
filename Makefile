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

PROVIDERS_FILE := .env.providers

switch-mock:
	@printf "PROVIDERS=%s\n" "bank=mock;kms=mock;rates=mock;statements=mock;anomaly=mock" > $(PROVIDERS_FILE)
	@echo "Provider bindings switched to mock"

switch-shadow:
	@printf "PROVIDERS=%s\n" "bank=shadow;kms=shadow;rates=shadow;statements=shadow;anomaly=shadow" > $(PROVIDERS_FILE)
	@echo "Provider bindings switched to shadow"

switch-real:
	@printf "PROVIDERS=%s\n" "bank=real;kms=real;rates=real;statements=real;anomaly=real" > $(PROVIDERS_FILE)
	@echo "Provider bindings switched to real"
	@curl --fail --silent --show-error http://localhost:3000/health/capabilities | sed 's/.*/Capabilities: &/'
