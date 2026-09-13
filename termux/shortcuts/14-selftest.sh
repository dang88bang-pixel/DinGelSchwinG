#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# Termux:Widget — Gateway-Selbsttest (Krypto, Whitelist, Widgets, Termux-API)
set -uo pipefail
REPO_DIR="${DGS_REPO:-}"
if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/mobile-server" ]; then
  for cand in "$HOME/DinGelSchwinG" "$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." 2>/dev/null && pwd)"; do
    [ -n "$cand" ] && [ -d "$cand/mobile-server" ] && { REPO_DIR="$cand"; break; }
  done
fi
[ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/mobile-server" ] || { echo "Repo nicht gefunden - DGS_REPO in ~/.dgs/gateway.env setzen" >&2; exit 1; }
LOG="$HOME/.dgs/logs/selftest-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOG")"
if python3 "$REPO_DIR/mobile-server/mobile_ble_server.py" selftest 2>&1 | tee "$LOG" | grep -E "BESTANDEN|FEHLGESCHLAGEN|❌" ; then :; fi
if grep -q "BESTANDEN" "$LOG"; then
  command -v termux-toast >/dev/null 2>&1 && termux-toast "Selbsttest bestanden" || true
else
  command -v termux-notification >/dev/null 2>&1 && termux-notification --title "Selbsttest" --content "Fehler – siehe $LOG" --id dgs-selftest || true
fi
echo "Log: $LOG"
