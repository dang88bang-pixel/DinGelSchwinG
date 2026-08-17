#!/usr/bin/env bash
# Startet API + WS-Dienste (+ optional Frontend).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
mkdir -p logs

if [[ "${1:-}" == "--docker" ]]; then
  exec docker compose up --build
fi

stop() {
  for pidfile in logs/*.pid; do
    [[ -f "$pidfile" ]] || continue
    kill "$(cat "$pidfile")" 2>/dev/null || true
    rm -f "$pidfile"
  done
}
trap stop EXIT INT TERM

python3 server/app.py >> logs/api.log 2>&1 & echo $! > logs/api.pid
python3 -m server.pty_bridge >> logs/pty.log 2>&1 & echo $! > logs/pty.pid
python3 -m server.scanner_service >> logs/scan.log 2>&1 & echo $! > logs/scan.pid
python3 -m server.status_board >> logs/status.log 2>&1 & echo $! > logs/status.pid

echo "API     :5000   (pid $(cat logs/api.pid))"
echo "Terminal:8765   (pid $(cat logs/pty.pid))"
echo "Discover:8766   (pid $(cat logs/scan.pid))"
echo "Status  :8767   (pid $(cat logs/status.pid))"

if [[ "${1:-}" != "--backend-only" ]]; then
  if command -v npm >/dev/null; then
    npm run dev -- --host 0.0.0.0 --port 5173
  else
    echo "npm fehlt — nur Backend läuft. Beenden mit Ctrl+C."
    wait
  fi
else
  wait
fi
