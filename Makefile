# Ring - root dev orchestration.
# `make start` brings up the whole stack for local development:
#   1. PostgreSQL (Docker, idempotent - no-op if already running)
#   2. Go backend (ringd) in hot-reload mode via `air`
#   3. Frontend (Vite) in hot-reload mode
#
# Backend and frontend run concurrently in the foreground; Ctrl+C stops both.

SHELL := /bin/bash
SERVER_DIR := server
GOBIN := $(shell go env GOPATH)/bin
AIR := $(GOBIN)/air

.PHONY: start stop db-up db-down tools backend frontend

## start: database (if needed) + backend hot reload + frontend hot reload
start: db-up tools
	@echo "▶ Starting backend (air) + frontend (vite) - Ctrl+C to stop both"
	@trap 'kill 0' INT TERM EXIT; \
		( cd $(SERVER_DIR) && set -a && { [ -f .env ] && . ./.env; }; set +a; $(AIR) ) & \
		( npm run dev ) & \
		wait

## db-up: start local PostgreSQL 18 if it isn't already running
db-up:
	@echo "▶ Ensuring PostgreSQL is up…"
	@cd $(SERVER_DIR) && docker compose up -d

## db-down: stop local PostgreSQL (keeps the data volume)
db-down:
	@cd $(SERVER_DIR) && docker compose down

## stop: tear everything down (db + any stray air/vite processes)
stop:
	@cd $(SERVER_DIR) && docker compose down
	-@pkill -f "$(AIR)" 2>/dev/null || true
	-@pkill -f "ringd" 2>/dev/null || true
	-@pkill -f "vite" 2>/dev/null || true

## backend: run only the backend in hot-reload mode
backend: tools
	@cd $(SERVER_DIR) && set -a && { [ -f .env ] && . ./.env; }; set +a; $(AIR)

## frontend: run only the frontend in hot-reload mode
frontend:
	@npm run dev

## tools: install air (Go live-reload) if missing
tools: $(AIR)
$(AIR):
	@echo "▶ Installing air (Go live reload)…"
	@go install github.com/air-verse/air@latest
