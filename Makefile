SHELL := /bin/bash

.PHONY: up up-dev down logs shell rebuild ps fmt \
        dev-up dev-down dev-seed dev-demo test-unit test-golden

DEV_COMPOSE_FILES := docker-compose.yml docker-compose.override.yml \
        docker-compose.dev.yaml docker-compose.gui.yaml docker-compose.metrics.yml
DEV_COMPOSE_ARGS := $(foreach file,$(DEV_COMPOSE_FILES),$(if $(wildcard $(file)),-f $(file),))

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

dev-up:
	@echo "Starting full developer stack..."
	@docker compose $(DEV_COMPOSE_ARGS) up -d --build --remove-orphans

dev-down:
	@echo "Stopping developer stack..."
	@docker compose $(DEV_COMPOSE_ARGS) down -v

dev-seed:
	@echo "Installing JavaScript dependencies (npm ci)..."
	@npm ci --ignore-scripts
	@echo "Seeding development database via scripts/seed_rpt_local.mjs..."
	@node scripts/seed_rpt_local.mjs

test-unit:
	@python -m pytest tests/test_math.py

test-golden:
	@python -m pytest tests/golden

dev-demo: test-golden
	@echo "Opening developer UI at http://localhost:8080"
	@python -m webbrowser http://localhost:8080
