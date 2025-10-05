SHELL := /bin/bash

PGHOST ?= 127.0.0.1
PGPORT ?= 5432
PGUSER ?= postgres
PGPASSWORD ?= postgres
PGDATABASE ?= apgms
SEED ?= seeds/seed_small.sql
MIGRATIONS_DIR ?= migrations
MIGRATIONS := $(sort $(wildcard $(MIGRATIONS_DIR)/*.sql))

PSQL ?= PGPASSWORD=$(PGPASSWORD) psql -h $(PGHOST) -p $(PGPORT) -U $(PGUSER)

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

.PHONY: db-drop db-create db-migrate db-seed db-fresh

db-drop:
	@echo "Dropping database $(PGDATABASE)"
	@$(PSQL) -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS "$(PGDATABASE)";"

db-create:
	@echo "Creating database $(PGDATABASE)"
	@$(PSQL) -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE "$(PGDATABASE)";"

db-migrate:
	@if [ -z "$(MIGRATIONS)" ]; then echo "No migration files found in $(MIGRATIONS_DIR)"; exit 1; fi
	@for file in $(MIGRATIONS); do \
		echo "Applying $$file"; \
		$(PSQL) -d $(PGDATABASE) -v ON_ERROR_STOP=1 -f $$file; \
	done

db-seed:
	@if [ ! -f "$(SEED)" ]; then echo "Seed file $(SEED) not found"; exit 1; fi
	@echo "Seeding $(PGDATABASE) with $(SEED)"
	@$(PSQL) -d $(PGDATABASE) -v ON_ERROR_STOP=1 -f $(SEED)

db-fresh: db-drop db-create db-migrate db-seed
