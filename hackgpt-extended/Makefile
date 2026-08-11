# NEXUS-BUILDER v2.2 — Makefile (Projekt-Kommandos)
# Make-Targets: help install build up down logs reset test

SHELL := /bin/bash
PY    := python3
DOCKER := docker

.PHONY: help install build up down logs reset test

help: ## Zeigt alle Targets
	@echo "NEXUS-BUILDER v2.2 — Kommandos:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n", $$1, $$2}'

install: ## Installiert Abhängigkeiten (npm + pip)
	npm install --no-audit --no-fund
	cd server && pip install -q -r requirements.txt

build: ## Baut das Frontend
	npm run build

up: ## Startet alle Dienste (start.sh)
	./start.sh

down: ## Stoppt alle Dienste
	-pkill -f 'python3 app.py' || true
	-pkill -f 'python3 pty_bridge.py' || true
	-pkill -f 'python3 scanner.py' || true
	-pkill -f 'python3 status.py' || true
	-pkill -f 'vite' || true

logs: ## Zeigt Logs (tail -f)
	tail -f logs/*.log 2>/dev/null || echo "Keine Logs (erst: make up)"

reset: ## Löscht die SQLite-Datenbank (Geräte/Pairings/Clients/Audit)
	rm -f data/hackgpt.db && echo "Datenbank zurückgesetzt"

test: ## Führt den System-Health-Check aus
	cd server && python3 -c "import db,audit,rights,security,userstore,webauthn,app,pty_bridge,scanner,status; print('Server-Module OK')"
	cd tests && python3 unit_prod.py
	node tests/offline_sw.mjs
	python3 tests/wasm_interp.py ../public/wasm/ble_distance_bg.wasm
	node tests/wasm_ble.test.mjs

wasm: ## BLE-Distanz-WASM deterministisch bauen + verifizieren
	python3 scripts/build-wasm.py
	python3 tests/wasm_interp.py public/wasm/ble_distance_bg.wasm
	node tests/wasm_ble.test.mjs
