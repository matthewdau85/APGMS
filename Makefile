SHELL := /bin/bash

ENV_FILE ?= .env
HEALTH_CHECK_URL ?= http://localhost:8000/health/capabilities

.PHONY: switch-mock switch-shadow switch-real _write-env

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
	@$(MAKE) _write-env APP_PROFILE=dev \
	        PROVIDERS="bank=mock;kms=mock;rates=mock;idp=dev;statements=mock" \
	        SHADOW_MODE=false \
	        PROTO_KILL_SWITCH=true

switch-shadow:
	@$(MAKE) _write-env APP_PROFILE=dev \
	        PROVIDERS="bank=mock;kms=mock;rates=mock;idp=dev;statements=mock" \
	        SHADOW_MODE=true \
	        PROTO_KILL_SWITCH=true

switch-real:
	@curl --fail --silent --show-error "$(HEALTH_CHECK_URL)" >/dev/null
	@$(MAKE) _write-env APP_PROFILE=prod \
	        PROVIDERS="bank=real;kms=real;rates=real;idp=prod;statements=real" \
	        SHADOW_MODE=false \
	        PROTO_KILL_SWITCH=false

_write-env:
	@python tools/update_env.py "$(ENV_FILE)" \
	        "APP_PROFILE=$(APP_PROFILE)" \
	        "PROVIDERS=$(PROVIDERS)" \
	        "SHADOW_MODE=$(SHADOW_MODE)" \
	        "PROTO_KILL_SWITCH=$(PROTO_KILL_SWITCH)"
