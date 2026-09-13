#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# Termux:Widget — Gateway neu starten
set -uo pipefail
REPO_DIR="${DGS_REPO:-}"
if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/mobile-server" ]; then
  for cand in "$HOME/DinGelSchwinG" "$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/../.." 2>/dev/null && pwd)"; do
    [ -n "$cand" ] && [ -d "$cand/mobile-server" ] && { REPO_DIR="$cand"; break; }
  done
fi
[ -n "$REPO_DIR" ] && [ -d "$REPO_DIR/mobile-server" ] || { echo "Repo nicht gefunden - DGS_REPO in ~/.dgs/gateway.env setzen" >&2; exit 1; }
bash "$REPO_DIR/termux/shortcuts/12-gateway-stop.sh" >/dev/null 2>&1 || true
sleep 1
exec bash "$REPO_DIR/termux/shortcuts/11-gateway-start.sh"
