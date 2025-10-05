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

switch-mock:
	@./node_modules/.bin/tsx tools/switch-mode.ts mock

switch-shadow:
	@./node_modules/.bin/tsx tools/switch-mode.ts shadow

switch-real:
	@./node_modules/.bin/tsx tools/switch-mode.ts real
