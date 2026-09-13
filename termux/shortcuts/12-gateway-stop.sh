#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# Termux:Widget — Gateway stoppen (PID-Datei, sonst Port-Suche)
set -uo pipefail
[ -f "$HOME/.dgs/gateway.env" ] && { set -a; . "$HOME/.dgs/gateway.env"; set +a; }
PID_FILE="$HOME/.dgs/gateway.pid"
stopped=0
if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && stopped=1
    for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
if [ "$stopped" = "0" ] && command -v sv >/dev/null 2>&1 && sv status dgs-gateway >/dev/null 2>&1; then
  sv down dgs-gateway >/dev/null 2>&1 && stopped=1
fi
if [ "$stopped" = "1" ]; then
  echo "✅ Gateway gestoppt"
  command -v termux-toast >/dev/null 2>&1 && termux-toast "Gateway gestoppt" || true
else
  echo "ℹ️  Kein laufendes Gateway gefunden"
fi
