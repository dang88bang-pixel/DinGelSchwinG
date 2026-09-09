#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fetch-android-tools.sh
#
# Besorgt ARM64-Binaries von adb + fastboot und legt sie in
#   android/app/src/main/assets/devicecontrol/{adb,fastboot}
# ab. Danach: App neu bauen (cd android && ./gradlew assembleRelease).
#
# Verhalten:
#   - Liegt bereits ein echtes ELF-Binary, wird es NICHT ueberschrieben
#     (FORCE=1 erzwingt den Neu-Download).
#   - Das Repo wird bereits mit einem echten ARM64-adb ausgeliefert
#     (Quelle: LADB, Apache-2.0, siehe LICENSE-adb-ladb.txt) – dieses
#     Skript ergaenzt also vor allem fastboot bzw. aktualisiert auf Wunsch.
#
# Quellen (Prioritaet):
#   0. $ADB_URL / $FASTBOOT_URL      – eigene Direkt-URLs
#   1. Termux-Paket "android-tools"  – beide Binaries, SHA-256-geprueft
#      (Apache-2.0; Termux-Binaries sind fuer die Termux-Umgebung gelinkt
#      und laufen nicht ueberall ohne Termux-Laufzeit)
#   2. GitHub-Fallback fuer adb      – tytydraco/LADB arm64-v8a/libadb.so
#      (Apache-2.0, laeuft ohne Zusatzumgebung auf Android)
#
# Fuer fastboot gibt es keinen GitHub-Fallback (kein vertrauenswuerdiges
# arm64-Prebuilt gefunden) – bleibt es beim Platzhalter, meldet die App
# spaeter eine klare Handlungsanweisung statt abzustuerzen.
#
# Voraussetzungen: curl; fuer den Termux-Pfad zusaetzlich xz, tar, ar
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/android/app/src/main/assets/devicecontrol"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FORCE="${FORCE:-0}"

mkdir -p "$DEST"

is_elf() { head -c 4 "$1" | od -An -tx1 | tr -d ' \n' | grep -q '^7f454c46'; }

install_binary() { # $1 = Quelldatei, $2 = Zielname ; true bei Erfolg
    local src="$1" name="$2"
    if is_elf "$src"; then
        cp "$src" "$DEST/$name"
        echo "✅ $name installiert ($(du -h "$DEST/$name" | cut -f1), ELF ok)"
        return 0
    fi
    echo "⚠️ $src ist kein ELF-Binary – $name bleibt unveraendert." >&2
    return 1
}

need_update() { # $1 = Zielname ; true wenn Platzhalter/fehlend oder FORCE
    local f="$DEST/$1"
    [[ "$FORCE" == "1" ]] && return 0
    [[ ! -f "$f" ]] && return 0
    is_elf "$f" && return 1
    return 0
}

# ── 0. Direkt-URLs ──────────────────────────────────────────────────────────
if [[ -n "${ADB_URL:-}" ]] && need_update adb; then
    echo "→ Lade adb von $ADB_URL"
    curl -fL --retry 3 --max-time 300 -o "$TMP/adb.url" "$ADB_URL" \
        && install_binary "$TMP/adb.url" adb || true
fi
if [[ -n "${FASTBOOT_URL:-}" ]] && need_update fastboot; then
    echo "→ Lade fastboot von $FASTBOOT_URL"
    curl -fL --retry 3 --max-time 300 -o "$TMP/fastboot.url" "$FASTBOOT_URL" \
        && install_binary "$TMP/fastboot.url" fastboot || true
fi

# ── 1. Termux-Paketindex (beide Binaries) ───────────────────────────────────
try_termux() {
    local REPO="https://packages.termux.dev/apt/termux-main"
    echo "→ Versuche Termux-Paket 'android-tools'"
    if curl -fsSL --max-time 60 "$REPO/dists/stable/main/binary-aarch64/Packages" -o "$TMP/Packages" 2>/dev/null; then
        :
    elif curl -fsSL --max-time 60 "$REPO/dists/stable/main/binary-aarch64/Packages.xz" -o "$TMP/Packages.xz" 2>/dev/null; then
        xz -dc "$TMP/Packages.xz" > "$TMP/Packages" || return 1
    else
        echo "  ✗ Termux-Paketindex nicht erreichbar."
        return 1
    fi

    awk '/^Package: android-tools$/{found=1} found{print} found && /^$/{exit}' \
        "$TMP/Packages" > "$TMP/pkg"
    grep -q '^Package: android-tools$' "$TMP/pkg" || return 1

    local FILENAME SHA256 VERSION
    FILENAME="$(sed -n 's/^Filename: //p' "$TMP/pkg")"
    SHA256="$(sed -n 's/^SHA256: //p' "$TMP/pkg")"
    VERSION="$(sed -n 's/^Version: //p' "$TMP/pkg")"
    echo "  android-tools $VERSION ($FILENAME)"

    curl -fL --retry 2 --max-time 300 -o "$TMP/android-tools.deb" "$REPO/$FILENAME" || return 1

    if command -v sha256sum >/dev/null && [[ -n "$SHA256" ]]; then
        echo "$SHA256  $TMP/android-tools.deb" | sha256sum -c - >/dev/null \
            || { echo "  ✗ SHA-256 stimmt nicht!"; return 1; }
        echo "  ✅ SHA-256 geprüft"
    fi

    (
        cd "$TMP" || exit 1
        ar x android-tools.deb || exit 1
        TARDATA="$(ls data.tar.* | head -1)"
        tar -xf "$TARDATA" --wildcards '*usr/bin/adb' '*usr/bin/fastboot' || exit 1
    ) || return 1

    local ADB_BIN FB_BIN RC=1
    ADB_BIN="$(find "$TMP" -path '*usr/bin/adb' -type f | head -1)"
    FB_BIN="$(find "$TMP" -path '*usr/bin/fastboot' -type f | head -1)"
    if [[ -n "$ADB_BIN" ]] && need_update adb && install_binary "$ADB_BIN" adb; then RC=0; fi
    if [[ -n "$FB_BIN" ]] && need_update fastboot && install_binary "$FB_BIN" fastboot; then RC=0; fi
    return $RC
}

# ── 2. GitHub-Fallback fuer adb (LADB, Apache-2.0) ──────────────────────────
try_ladb_adb() {
    echo "→ Versuche GitHub-Fallback fuer adb (tytydraco/LADB, Apache-2.0)"
    command -v python3 >/dev/null || { echo "  ✗ python3 fehlt."; return 1; }
    local API="https://api.github.com/repos/tytydraco/LADB" SHA
    SHA="$(curl -fsSL --max-time 60 "$API/git/trees/main?recursive=1" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    for t in d.get("tree", []):
        if t.get("path") == "app/src/main/jniLibs/arm64-v8a/libadb.so":
            print(t.get("sha", ""))
            break
except Exception:
    pass')"
    [[ -n "$SHA" ]] || { echo "  ✗ Blob-SHA nicht ermittelbar."; return 1; }
    curl -fsSL --max-time 300 -H "Accept: application/vnd.github.raw" \
        "$API/git/blobs/$SHA" -o "$TMP/ladb-adb.so" || return 1
    if install_binary "$TMP/ladb-adb.so" adb; then
        echo "  Quelle: tytydraco/LADB (arm64-v8a/libadb.so, Apache-2.0)"
        return 0
    fi
    return 1
}

if need_update adb || need_update fastboot; then
    try_termux || true
fi
if need_update adb; then
    try_ladb_adb || true
fi

echo ""
echo "── Ergebnis ────────────────────────────────────────────────"
for b in adb fastboot; do
    if is_elf "$DEST/$b"; then
        echo "$b: ✅ echtes Binary vorhanden ($(du -h "$DEST/$b" | cut -f1))"
    else
        echo "$b: ⚠️ Platzhalter – App meldet Handlungsanweisung bei Nutzung"
    fi
done
echo ""
echo "Weiter: cd android && ./gradlew assembleRelease"

# Erfolg, sobald adb ein echtes Binary ist (fastboot ist optional, da die
# App dessen Fehlen sauber abfedert).
is_elf "$DEST/adb"
