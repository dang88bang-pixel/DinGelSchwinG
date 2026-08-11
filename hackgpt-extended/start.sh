#!/usr/bin/env bash
# NEXUS-BUILDER v2.2 — Startskript für alle Dienste (reproduzierbar)
# Installiert Abhängigkeiten (falls fehlend) und startet alle 5 Dienste im Hintergrund.
# Usage: ./start.sh            (Start/Reinstall)
#        ./start.sh --docker   (Start via docker compose stattdessen)
#
# Produktion: SECRET_KEY setzen (min. 32 Zeichen). In Produktion bricht der
# Start ab, wenn SECRET_KEY fehlt (fail-fast, kein unsicherer Default).

set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  echo "▶ .env geladen"
  set -a; source .env; set +a
fi

export APP_ENV="${APP_ENV:-development}"
export SECRET_KEY="${SECRET_KEY:-}"
# VITE_API_BASE/VITE_WS_BASE: echte Domain (Produktion) — sonst same-origin.
export VITE_API_BASE="${VITE_API_BASE:-}"
export VITE_WS_BASE="${VITE_WS_BASE:-}"

if [[ "$APP_ENV" == "production" && ( -z "$SECRET_KEY" || ${#SECRET_KEY} -lt 32 || "$SECRET_KEY" == "ChangeMe-In-Production" ) ]]; then
  echo "❌ Produktion: SECRET_KEY muss gesetzt sein (min. 32 Zeichen) — siehe .env.example" >&2
  exit 1
fi
if [[ -z "$SECRET_KEY" ]]; then
  echo "⚠  SECRET_KEY nicht gesetzt — Dienste starten mit zufälligem Sitzungs-Key (nur Entwicklung/Test!)"
fi

if [[ "${1:-}" == "--docker" ]]; then
  echo "▶ Start via docker compose…"
  docker compose up --build -d
  exit 0
fi

echo "═══════ NEXUS-BUILDER v2.2 — Dienst-Start ═══════"

# 1) Abhängigkeiten (nur installieren, wenn fehlend)
if [[ ! -d node_modules ]] || ! node -e "require('react')" 2>/dev/null; then
  echo "▶ npm install…"
  npm install --no-audit --no-fund
fi
if ! python3 -c "import flask, jwt, websockets, cbor2, cryptography" 2>/dev/null; then
  echo "▶ pip install (Server-Dependencies)…"
  pip install -q -r server/requirements.txt
fi

# 2) Build (fehlerfreier Code ist Voraussetzung; VITE_*-Env wird eingebacken)
echo "▶ Frontend-Build…"
npm run build >/dev/null 2>&1 && echo "   Build OK"

# 3) Dienste starten (PID-Dateien, Logs nach logs/)
mkdir -p logs
start() {
  local name="$1" cmd="$2"
  if pgrep -f "python3 $name.py" >/dev/null 2>&1 || pgrep -f "$name" >/dev/null 2>&1; then echo "   $name läuft bereits"; return; fi
  echo "▶ starte $name…"
  ( eval "$cmd" >> "logs/$name.log" 2>&1 & echo $! > "logs/$name.pid" )
}
start auth   "cd server && python3 app.py"
start bridge "cd server && python3 pty_bridge.py"
start scan   "cd server && python3 scanner.py"
start status "cd server && python3 status.py"
start web    "npm run preview -- --host 0.0.0.0 --port 4173"

echo ""
echo "═══════ Laufende Dienste ═══════"
echo "  Auth-REST   : http://localhost:5000  (/api/health)"
echo "  Terminal-WS : ws://localhost:8765"
echo "  Discovery-WS: ws://localhost:8766"
echo "  Status-WS   : ws://localhost:8767"
echo "  Frontend    : http://localhost:4173  (Produktions-Preview)"
echo "  Logs        : logs/*.log"
echo ""
echo "  ▶ Zum Stoppen:  pkill -f 'python3 (app|pty_bridge|scanner|status).py'; pkill -f 'vite preview'"
