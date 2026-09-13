#!/data/data/com.termux/files/usr/bin/bash
# REAL-IMPLEMENTATION 2026-09-13 — echte Termux-Anbindung (kein Demo-/Mock-Pfad)
# ─────────────────────────────────────────────────────────────────────────────
# DinGelSchwinG · Termux-Installer (Termux · Termux:API · Termux:Widget)
#
# Installiert und verdrahtet auf einem Android-Gerät:
#   1. Pakete            : python, termux-api, termux-services, termux-tools
#   2. Gateway-Skripte   : ~/.shortcuts/*.sh      (Termux:Widget — Tippen startet)
#   3. Autostart         : ~/.termux/boot/…       (Termux:Boot, optional)
#   4. Dienst            : $PREFIX/var/service/dgs-gateway (termux-services, optional)
#   5. Konfiguration     : ~/.dgs/gateway.env + Schlüssel (chmod 600)
#   6. Selbsttest        : führt den Gateway-Selbsttest aus und zeigt das Ergebnis
#
# Aufruf (im Termux):
#   bash termux/install.sh                 # Standard: Pakete, Widgets, Dienst
#   bash termux/install.sh --no-service    # ohne termux-services
#   bash termux/install.sh --no-packages   # nur Dateien/Widgets anlegen
#   bash termux/install.sh --prefix /pfad  # anderes Repo-Verzeichnis
#
# Idempotent: mehrfaches Ausführen ist unschädlich.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
PREFIX_DIR="${PREFIX:-/data/data/com.termux/files/usr}"
SHORTCUTS="$HOME_DIR/.shortcuts"
BOOT_DIR="$HOME_DIR/.termux/boot"
DGS_DIR="$HOME_DIR/.dgs"
SERVICE_DIR="$PREFIX_DIR/var/service/dgs-gateway"
ENV_FILE="$DGS_DIR/gateway.env"

WITH_PACKAGES=1
WITH_SERVICE=1
WITH_BOOT=1
FORCE=0

TEXT_BOLD=$'\033[1m'; TEXT_DIM=$'\033[2m'; TEXT_OFF=$'\033[0m'
ok()   { printf '  \033[32m✅\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠️ \033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m❌\033[0m %s\n' "$1"; }
step() { printf '\n%s%s%s\n' "$TEXT_BOLD" "$1" "$TEXT_OFF"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --no-packages) WITH_PACKAGES=0 ;;
    --no-service)  WITH_SERVICE=0 ;;
    --no-boot)     WITH_BOOT=0 ;;
    --force)       FORCE=1 ;;
    --prefix)      shift; REPO_DIR="$1" ;;
    -h|--help)     sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
  esac
  shift
done

printf '%s\n' "${TEXT_BOLD}DinGelSchwinG — Termux-Anbindung${TEXT_OFF}"
printf '%s\n' "${TEXT_DIM}Repo: $REPO_DIR${TEXT_OFF}"

# ── 0) Umgebung prüfen ──────────────────────────────────────────────────────
step "0) Umgebung"
if [ ! -d "$PREFIX_DIR/bin" ]; then
  bad "Kein Termux-PREFIX gefunden ($PREFIX_DIR)."
  echo "    Dieses Skript läuft *in* der Termux-App:  bash $REPO_DIR/termux/install.sh"
  exit 1
fi
ok "Termux erkannt: PREFIX=$PREFIX_DIR"
[ -f "$REPO_DIR/mobile-server/mobile_ble_server.py" ] || { bad "Repo unvollständig: mobile-server/ fehlt"; exit 1; }
ok "Repo gefunden: $(basename "$REPO_DIR")"

missing_pkgs=()
command -v python3 >/dev/null 2>&1 || missing_pkgs+=("python")
command -v termux-battery-status >/dev/null 2>&1 || missing_pkgs+=("termux-api")
[ -d "$PREFIX_DIR/var/service" ] || true   # termux-services legt das Verzeichnis an

# ── 1) Pakete ───────────────────────────────────────────────────────────────
step "1) Pakete"
if [ "$WITH_PACKAGES" -eq 1 ]; then
  if [ "${#missing_pkgs[@]}" -gt 0 ]; then
    echo "  Installiere: ${missing_pkgs[*]} termux-services termux-tools"
    pkg install -y "${missing_pkgs[@]}" termux-services termux-tools || warn "pkg install unvollständig – später erneut versuchen"
  else
    ok "python3 und termux-api bereits vorhanden"
  fi
  pkg install -y termux-services termux-tools >/dev/null 2>&1 || true
else
  warn "Paketinstallation übersprungen (--no-packages)"
fi

if command -v termux-battery-status >/dev/null 2>&1; then
  ok "Termux:API-Kommandos verfügbar (termux-api)"
else
  warn "Termux:API fehlt. APK aus F-Droid installieren: Termux:API  →  danach 'pkg install termux-api'"
  command -v termux-open-url >/dev/null 2>&1 && termux-open-url 'https://f-droid.org/packages/com.termux.api/' || true
fi

# ── 2) Verzeichnisse + Konfiguration ────────────────────────────────────────
step "2) Konfiguration"
mkdir -p "$SHORTCUTS" "$DGS_DIR" "$DGS_DIR/logs"
chmod 700 "$DGS_DIR"
if [ -f "$ENV_FILE" ] && [ "$FORCE" -eq 0 ]; then
  ok "$ENV_FILE existiert bereits (bleibt unverändert; --force überschreibt)"
else
  cat > "$ENV_FILE" <<EOF
# DinGelSchwinG Gateway – Termux-Konfiguration (chmod 600)
# Erzeugt von termux/install.sh am $(date '+%Y-%m-%d %H:%M')
DGS_REPO="$REPO_DIR"
# Ports (müssen zu App/Desktop passen; PortView findet sie automatisch)
DGS_TCP_HOST=0.0.0.0
DGS_TCP_PORT=8765
DGS_HTTP_PORT=8791
DGS_BRIDGE_PORT=8790
DGS_DISCOVER=1
# BLE-Backend: auto|mock|bluetoothctl|gdbus  (auto = bluetoothctl, sonst mock)
DGS_BLE_BACKEND=auto
# Datenablage (Whitelist/Audit/Sessions) — bleibt im Home, nicht im Repo
DGS_DATA_DIR="$DGS_DIR/data"
# Termux-Widgets
DGS_TERMUX_WIDGET_DIR="$SHORTCUTS"
EOF
  chmod 600 "$ENV_FILE"
  ok "$ENV_FILE angelegt (chmod 600)"
fi
mkdir -p "$DGS_DIR/data"

# ── 3) Widget-Skripte (Termux:Widget) ───────────────────────────────────────
step "3) Termux:Widget-Skripte"
installed_widgets=0
for script in "$REPO_DIR"/termux/shortcuts/*.sh; do
  [ -f "$script" ] || continue
  name="$(basename "$script")"
  target="$SHORTCUTS/$name"
  if [ -e "$target" ] && [ "$FORCE" -eq 0 ] && ! cmp -s "$script" "$target"; then
    warn "$name existiert abweichend – übersprungen (--force zum Ersetzen)"
    continue
  fi
  cp "$script" "$target"
  chmod 755 "$target"
  installed_widgets=$((installed_widgets + 1))
done
ok "$installed_widgets Widget-Skript(e) in $SHORTCUTS"
if [ -d "$HOME_DIR/.termux" ] || command -v termux-open-url >/dev/null 2>&1; then
  printf '    %sTermux:Widget-APK noch nicht installiert? F-Droid: Termux:Widget%s\n' "$TEXT_DIM" "$TEXT_OFF"
fi

# ── 4) Autostart (Termux:Boot) ──────────────────────────────────────────────
step "4) Autostart"
if [ "$WITH_BOOT" -eq 1 ]; then
  mkdir -p "$BOOT_DIR"
  cp "$REPO_DIR/termux/boot/10-dingelschwing-gateway.sh" "$BOOT_DIR/" 2>/dev/null || true
  chmod 755 "$BOOT_DIR"/10-dingelschwing-gateway.sh 2>/dev/null || true
  ok "Boot-Skript in $BOOT_DIR (wirkt, wenn die Termux:Boot-APK installiert ist)"
else
  warn "Autostart übersprungen (--no-boot)"
fi

# ── 5) Dienst (termux-services) ─────────────────────────────────────────────
step "5) Dienst"
if [ "$WITH_SERVICE" -eq 1 ] && [ -d "$PREFIX_DIR/var/service" ]; then
  mkdir -p "$SERVICE_DIR/log"
  cat > "$SERVICE_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec 2>&1
set -a
. "$ENV_FILE"
set +a
exec "\$DGS_REPO/termux/run-gateway.sh"
EOF
  chmod 755 "$SERVICE_DIR/run"
  cat > "$SERVICE_DIR/log/run" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
exec svlogd -tt "$HOME/.dgs/logs/sv"
EOF
  chmod 755 "$SERVICE_DIR/log/run"
  ok "Dienst angelegt: $SERVICE_DIR"
  if command -v sv >/dev/null 2>&1; then
    sv-enable dgs-gateway >/dev/null 2>&1 || true
    sv up dgs-gateway >/dev/null 2>&1 || true
    sleep 2
    if sv status dgs-gateway 2>/dev/null | grep -q '^run:'; then
      ok "Dienst läuft (sv status dgs-gateway)"
    else
      warn "Dienst angelegt, aber (noch) nicht 'run' – Logs: svlogd ~/.dgs/logs/sv"
    fi
  else
    warn "termux-services nicht installiert – später: pkg install termux-services && sv-enable dgs-gateway"
  fi
else
  warn "Dienst übersprungen (--no-service oder termux-services fehlt)"
fi

# ── 6) Selbsttest ───────────────────────────────────────────────────────────
step "6) Selbsttest"
set -a; . "$ENV_FILE"; set +a
if python3 "$REPO_DIR/mobile-server/termux_bridge.py" capabilities >/tmp/dgs-termux-caps.json 2>/dev/null; then
  python3 - "$REPO_DIR" <<'PY'
import json, sys, pathlib
caps = json.loads(pathlib.Path("/tmp/dgs-termux-caps.json").read_text())
print(f"  Termux        : {'ja' if caps['termux'] else 'nein'}")
print(f"  Termux:API    : {caps['api']['count']}/{caps['api']['total']} Kommandos")
print(f"  Termux:Widget : {caps['widgets']['count']} Skript(e) in {caps['widgets']['dir']}")
print(f"  Termux:Boot   : {'ja' if caps['boot']['ok'] else 'nein'}")
print(f"  Hinweis       : {caps['hint']}")
PY
else
  warn "Bestandsaufnahme fehlgeschlagen (python3 vorhanden?)"
fi

if [ "${DGS_SKIP_SELFTEST:-0}" != "1" ]; then
  if timeout 60 python3 "$REPO_DIR/mobile-server/mobile_ble_server.py" selftest >/tmp/dgs-termux-selftest.log 2>&1; then
    ok "Gateway-Selbsttest bestanden ($(grep -c '✅' /tmp/dgs-termux-selftest.log || true) Prüfungen)"
  else
    warn "Gateway-Selbsttest meldete Probleme – Log: /tmp/dgs-termux-selftest.log"
  fi
fi

cat <<EOF

${TEXT_BOLD}Fertig.${TEXT_OFF} Nächste Schritte:
  1. Widget einrichten: Launcher → Termux:Widget → „DinGelSchwinG Status“ antippen
  2. Status im Terminal : bash "$REPO_DIR/termux/shortcuts/10-gateway-status.sh"
  3. Gateway manuell    : bash "$REPO_DIR/termux/run-gateway.sh"
  4. App/Desktop finden den Port automatisch (PortView UDP :18791)
  5. Doku: "$REPO_DIR/docs/termux.md"

EOF
