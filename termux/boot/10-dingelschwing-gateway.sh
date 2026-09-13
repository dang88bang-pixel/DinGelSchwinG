#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# Termux:Boot — Gateway nach dem Gerätestart hochfahren (APK „Termux:Boot“ nötig).
# Liegt installiert in ~/.termux/boot/ und wird von der Boot-App ausgeführt.
termux-wake-lock 2>/dev/null || true
sleep 20                      # WLAN/Bluetooth brauchen nach dem Boot einen Moment
ENV_FILE="$HOME/.dgs/gateway.env"
[ -f "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }
REPO_DIR="${DGS_REPO:-$HOME/DinGelSchwinG}"
LOG="$HOME/.dgs/logs/boot.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Boot-Start"
  if command -v sv >/dev/null 2>&1 && sv status dgs-gateway >/dev/null 2>&1; then
    sv up dgs-gateway && echo "  Dienst über sv gestartet"
  else
    bash "$REPO_DIR/termux/run-gateway.sh" --daemon
  fi
} >>"$LOG" 2>&1
