.PHONY: install build up down logs reset test test-all test-py test-gw test-genesis test-web smoke inventar server

install:
	npm ci || npm install

build:
	npm run build

up:
	./start.sh --backend-only &
	npm run dev -- --host 0.0.0.0 --port 5173

down:
	@for f in logs/*.pid; do [ -f $$f ] && kill $$(cat $$f) 2>/dev/null || true; done
	rm -f logs/*.pid

logs:
	tail -n 80 -f logs/*.log

reset:
	rm -f server/data/data.db
	python3 -c "from server import store; store.init_db(); store.seed_users()"

# ---------------------------------------------------------------------------
# Test-Matrix (siehe GAP_MATRIX.md § Verifikationsprotokoll)
# ---------------------------------------------------------------------------

# Unit-Tests ohne laufende Dienste (Backend/PTY/Scanner/Status dürfen laufen,
# die Suites sind gegen Ambient-Dienste isoliert).
test-py:
	python3 -m unittest discover -s server/tests -v
	python3 -m unittest discover -s desktop/tests -v

# BLE-Gateway: Unit-Tests + Selftest (echte Sockets + Krypto).
test-gw:
	python3 mobile-server/tests/test_gateway.py
	python3 mobile-server/mobile_ble_server.py selftest

# Genesis-FastAPI (benötigt genesis-orchestrator/fastapi-backend/requirements.txt).
test-genesis:
	cd genesis-orchestrator/fastapi-backend && python3 tests/test_api.py

# Frontend: Typen, Unit-Tests (Vitest), Lint.
test-web:
	npm run type-check
	npm test
	npm run lint

# Funktionale Checks – benötigen ein laufendes Backend (`make server` / start.sh).
smoke:
	python3 tests/suite.py
	python3 tests/chain.py
	python3 tests/stress.py

# Alles ohne Smoke (läuft ohne Dienste).
test: test-py test-web

# Vollständige Matrix inkl. Gateway, Genesis und Live-Smoke.
test-all: test-py test-gw test-genesis test-web smoke

# Audit-Artefakt INVENTAR.csv neu erzeugen.
inventar:
	python3 scripts/audit_inventar.py

server:
	python3 server/app.py
