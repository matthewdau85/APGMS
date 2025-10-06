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

# ---------- Blue/Green deployment orchestration ----------
deploy-blue:
	@./ops/deploy/blue_green.py deploy blue

deploy-green:
	@./ops/deploy/blue_green.py deploy green

mark-ready:
	@test -n "$(COLOR)" || (echo "COLOR is required (e.g. make mark-ready COLOR=green)" && exit 1)
	@./ops/deploy/blue_green.py mark-ready $(COLOR)

gate:
	@./ops/deploy/blue_green.py gate $(if $(STATUS_URL),--status-url $(STATUS_URL),)

rollback:
	@./ops/deploy/blue_green.py rollback
