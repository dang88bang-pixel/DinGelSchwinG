.PHONY: install build up down logs reset test server universe

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

test:
	python3 -m unittest discover -s server/tests -v
	python3 -m unittest discover -s desktop/tests -v
	python3 tests/suite.py
	npm run type-check

# Projektagnostisches Audit + Test-Harness (Schritt 1 und 5)
# Hinweis: laufende Backends werden mitgeprüft, z. B. UNIVERSE_HEALTH_PORTS=5000,8791
universe:
	bash scripts/universe_audit.sh
	UNIVERSE_HEALTH_PORTS=$${UNIVERSE_HEALTH_PORTS:-5000,8765,8791} \
	  python3 tests/universe_harness.py --json reports/harness.json

server:
	python3 server/app.py
