#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# Termux:Widget — Gateway-Status (Antippen zeigt Zustand + Ports)
set -uo pipefail
REPO_DIR="${DGS_REPO:-}"
if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/mobile-server" ]; then
  for cand in "$HOME/DinGelSchwinG" "$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." 2>/dev/null && pwd)"; do
    [ -n "$cand" ] && [ -d "$cand/mobile-server" ] && { REPO_DIR="$cand"; break; }
  done
fi
[ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/mobile-server" ] || { echo "Repo nicht gefunden - DGS_REPO in ~/.dgs/gateway.env setzen" >&2; exit 1; }
[ -f "$HOME/.dgs/gateway.env" ] && { set -a; . "$HOME/.dgs/gateway.env"; set +a; }

PORT="${DGS_HTTP_PORT:-8791}"
PID_FILE="$HOME/.dgs/gateway.pid"

printf '🎫 DinGelSchwinG Gateway\n'
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  printf 'Prozess: läuft (PID %s)\n' "$(cat "$PID_FILE")"
else
  printf 'Prozess: gestoppt\n'
fi

STATUS="$(curl -s -m 3 "http://127.0.0.1:$PORT/status" 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
  # Daten per Umgebungsvariable uebergeben: Heredoc (Programm) und Here-String
  # (Daten) teilen sich sonst denselben stdin - python3 laese das JSON als
  # Programm. Genau dieser Fehler war vorher drin.
  STATUS="$STATUS" python3 - <<'PY'
import json, os
s = json.loads(os.environ["STATUS"])
cfg = s.get("config") or {}
ports = s.get("ports") or {}
print(f"HTTP   : ok auf :{ports.get('http', cfg.get('http'))} (tcp {ports.get('tcp', cfg.get('tcp'))})")
# Nicht cfg["mock"] zeigen, sondern das tatsaechlich aktive Backend: das Gateway
# faellt ohne bluetoothctl selbst auf "mock" zurueck und wuerde sonst "echtes BLE"
# behaupten.
ble = s.get("ble") or {}
backend = ble.get("backend") or "?"
print(f"BLE    : {backend}{' (Simulator)' if backend == 'mock' else ''} - Advertising {'an' if ble.get('advertising') else 'aus'}")
wl = s.get("whitelist") or {}
print(f"Token  : {wl.get('count', 0)} in der Whitelist, {wl.get('locked', 0)} gesperrt")
print(f"Uptime : {round(s.get('uptime_s', 0))} s - {s.get('connected_agents', 0)} Agent(en) verbunden")
t = s.get("termux") or {}
if t:
    w = t.get("widgets") or {}
    print(f"Termux : {'ja' if t.get('termux') else 'nein'} - API {t.get('api_present')}/{t.get('api_total')} - Widgets {w.get('count', 0)}")
    if t.get("hint"):
        print(f"Hinweis: {t['hint']}")
PY
else
  printf 'HTTP   : keine Antwort auf :%s\n' "$PORT"
  printf 'Start  : bash %s/termux/run-gateway.sh --daemon\n' "${REPO_DIR:-$HOME/DinGelSchwinG}"
fi

if command -v termux-notification >/dev/null 2>&1; then
  termux-notification --title "DinGelSchwinG Gateway" --content "$(printf 'Port %s · %s' "$PORT" "$([ -n "$STATUS" ] && echo erreichbar || echo offline)")" --id dgs-status >/dev/null 2>&1 || true
fi
