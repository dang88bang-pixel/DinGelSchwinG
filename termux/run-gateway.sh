#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# ─────────────────────────────────────────────────────────────────────────────
# DinGelSchwinG · Gateway-Start in Termux (gemeinsamer Startpunkt für Dienst,
# Boot-Skript, Widget und manuellen Start).
#
#   bash termux/run-gateway.sh            # Vordergrund (sv/Widget nutzen das)
#   bash termux/run-gateway.sh --daemon   # im Hintergrund mit PID-Datei + Log
#   bash termux/run-gateway.sh --mock     # ohne BLE-Hardware (Simulator)
#
# Umgebung: liest ~/.dgs/gateway.env, falls vorhanden.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${DGS_REPO:-$(cd "$HERE/.." && pwd)}"
DGS_DIR="${HOME:-/data/data/com.termux/files/home}/.dgs"
ENV_FILE="$DGS_DIR/gateway.env"
LOG_DIR="$DGS_DIR/logs"
PID_FILE="$DGS_DIR/gateway.pid"

[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
mkdir -p "$LOG_DIR" "${DGS_DATA_DIR:-$DGS_DIR/data}"

MODE="foreground"
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --daemon) MODE="daemon" ;;
    --mock)   ARGS+=(--mock) ;;
    *)        ARGS+=("$arg") ;;
  esac
done

PY="${PREFIX:-/data/data/com.termux/files/usr}/bin/python3"
command -v python3 >/dev/null 2>&1 || { echo "❌ python3 fehlt: pkg install python" >&2; exit 1; }
PY="$(command -v python3)"

SERVER="$REPO_DIR/mobile-server/mobile_ble_server.py"
[ -f "$SERVER" ] || { echo "❌ $SERVER nicht gefunden (DGS_REPO prüfen)" >&2; exit 1; }

# Widgets/Statusanzeigen informieren sich über dieselbe PID-Datei.
if [ "$MODE" = "daemon" ]; then
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "ℹ️  Gateway läuft bereits (PID $(cat "$PID_FILE"))"
    exit 0
  fi
  nohup "$PY" "$SERVER" run "${ARGS[@]}" >>"$LOG_DIR/gateway.log" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2
  if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "✅ Gateway gestartet (PID $(cat "$PID_FILE")) · Log: $LOG_DIR/gateway.log"
  else
    echo "❌ Gateway sofort beendet – Log: $LOG_DIR/gateway.log" >&2
    tail -n 20 "$LOG_DIR/gateway.log" >&2 || true
    exit 1
  fi
else
  echo $$ > "$PID_FILE"
  trap 'rm -f "$PID_FILE"' EXIT
  exec "$PY" "$SERVER" run "${ARGS[@]}"
fi
