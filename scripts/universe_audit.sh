#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Universe Audit — projektagnostische Bestandsaufnahme (Schritt 1)
# Werkzeuge: bash, git, grep, awk. Keine externen Abhängigkeiten.
# Erzeugt:    reports/inventory.md
#
# Erkennt zwei Signalklassen, weil Codebasen Attrappen unterschiedlich markieren:
#   (a) Kommentar-Marker   // TODO, # FIXME, /* STUB …
#   (b) Attrappen-Bezeichner MOCK_DEVICES, getMockByType, PlaceholderData …
# Treffer sind *Kandidaten* — die endgültige Einstufung macht der Agent (Kontext!).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

REPORT="reports/inventory.md"
mkdir -p reports backups

EXCLUDES=(
  --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build
  --exclude-dir=out --exclude-dir=target --exclude-dir=.venv --exclude-dir=venv
  --exclude-dir=__pycache__ --exclude-dir=.gradle --exclude-dir=.pytest_cache
  --exclude-dir=.mypy_cache --exclude-dir=.ruff_cache --exclude-dir=coverage
  --exclude-dir=reports --exclude-dir=backups --exclude-dir=android
)
INCLUDES=(
  --include='*.py' --include='*.js' --include='*.mjs' --include='*.cjs'
  --include='*.ts' --include='*.tsx' --include='*.jsx' --include='*.rs'
  --include='*.kt' --include='*.java' --include='*.cpp' --include='*.c' --include='*.h'
  --include='*.swift' --include='*.go' --include='*.gradle' --include='*.kts'
  --include='*.dart' --include='*.cs' --include='*.rb' --include='*.php'
)
# Werkzeuge, die die Suchmuster selbst enthalten, nicht als Fund melden.
SELF_FILES='^(\./)?(scripts/universe_audit\.sh|scripts/audit_inventar\.py|tests/universe_harness\.py)'
TOOL_DIRS='^(\./)?(scripts|tools)/'

# Signal-Muster ───────────────────────────────────────────────────────────────
COMMENT_MARKERS='(//|#|/\*|\*|<!--|--)[[:space:]]*(TODO|FIXME|MOCK|SHIM|STUB|PLACEHOLDER|HACK|XXX)([[:space:]]|:|$|\()'
MOCK_IDENTS='\b(MOCK_[A-Z0-9_]+|[A-Za-z_]*[Mm]ock[A-Z][A-Za-z]*|PLACEHOLDER_[A-Z0-9_]+|Placeholder[A-Z][A-Za-z]*|DUMMY_[A-Z0-9_]+|FAKE_[A-Z0-9_]+)'
DUMMY_RETURNS='return[[:space:]]+(None|0|false|true|\{\}|\[\]|null)|^[[:space:]]*pass[[:space:]]*$|^[[:space:]]*\.\.\.[[:space:]]*$'
NOT_IMPLEMENTED='(NotImplementedError|not[ _-]?implemented|unimplemented!|unimplemented\()'
TRIVIAL_TESTS='assert +(True|true)([^a-zA-Z]|$)|expect\( *(true|1) *\)\.toBe\( *(true|1) *\)|assert *(1)? *== *(1)? *$'

# scan <ERE> — Treffer (relativer Pfad, ohne Eigen-Werkzeuge), immer Exit 0.
scan() {
  grep -rnE "$1" "${INCLUDES[@]}" "${EXCLUDES[@]}" . 2>/dev/null \
    | sed 's|^\./||' | grep -vE "$SELF_FILES" || true
}

# scan_count <ERE> — Anzahl Treffer (immer eine Zahl).
scan_count() {
  scan "$1" | grep -c . || true
}

# block <titel> <inhalt…> — Codeblock; leer ⇒ "(keine Treffer)".
block() {
  local title="$1"; shift
  {
    echo "### $title"
    echo '```'
    if [ "$#" -gt 0 ] && [ -n "${1:-}" ]; then printf '%s\n' "$*"; else echo "(keine Treffer)"; fi
    echo '```'
    echo
  } >> "$REPORT"
}

# ── Kopf ─────────────────────────────────────────────────────────────────────
{
  echo "# Universe Inventory — $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo
  echo "Repo: \`$(basename "$ROOT")\` @ \`$(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')\`"
  echo "Erzeugt von: \`scripts/universe_audit.sh\` (Schritt 1 der Auftragsbeschreibung)"
  echo
  echo "Status-Legende: \`REAL\` = produktive Implementierung · \`MOCK\` = Attrappe im Produktionspfad ·"
  echo "\`STUB\` = bewusster Platzhalter · \`TODO/FIXME\` = offener Auftrag · \`PLACEHOLDER\` = Dummy-Datei/Daten ·"
  echo "\`DEAD\` = unreferenziert · \`DUAL\` = echt + Attrappe parallel."
  echo
  echo "> **Die Listen unten sind Kandidaten, kein Urteil.** Ein \`return None\` ist oft ein legitimer"
  echo "> Early-Exit, ein \`--mock\`-Flag ein dokumentierter Demo-Modus. Jeder Treffer wird vom Agenten"
  echo "> im Kontext bewertet und im Bericht (\`reports/universe-<datum>.md\`) final eingestuft."
  echo
} > "$REPORT"

# ── Erkannter Stack ──────────────────────────────────────────────────────────
java_ver="$(java -version 2>/dev/null | head -1 || true)"
gradle_ver="$( (cd android 2>/dev/null && ./gradlew -v 2>/dev/null | grep -m1 Gradle) || true)"
{
  echo "## Erkannter Stack"
  echo
  echo "### Manifeste (Wurzel)"
  for f in package.json package-lock.json pnpm-lock.yaml yarn.lock Cargo.toml build.gradle \
           build.gradle.kts settings.gradle settings.gradle.kts go.mod pyproject.toml \
           setup.py requirements.txt composer.json Gemfile Podfile pubspec.yaml Dockerfile \
           docker-compose.yml Makefile CMakeLists.txt capacitor.config.json; do
    [ -f "$ROOT/$f" ] && echo "- \`$f\`"
  done
  echo
  echo "### Manifeste in Unterprojekten (Monorepo-Anzeige)"
  find . -maxdepth 4 -type f \
    \( -name package.json -o -name Cargo.toml -o -name build.gradle -o -name build.gradle.kts \
       -o -name go.mod -o -name pyproject.toml -o -name requirements.txt -o -name pubspec.yaml \) \
    -not -path './node_modules/*' -not -path './.git/*' -not -path '*/node_modules/*' \
    -not -path './backups/*' 2>/dev/null | sort | sed 's|^\./|  - `|; s|$|`|' || true
  echo
  echo "### Toolchain-Versionen"
  echo '```'
  printf 'node   : %s\n' "$(node -v 2>/dev/null || echo 'fehlt')"
  printf 'npm    : %s\n' "$(npm -v 2>/dev/null || echo 'fehlt')"
  printf 'python : %s\n' "$(python3 -V 2>&1 || echo 'fehlt')"
  printf 'cargo  : %s\n' "$(cargo -V 2>/dev/null || echo 'fehlt')"
  printf 'go     : %s\n' "$(go version 2>/dev/null || echo 'fehlt')"
  printf 'java   : %s\n' "${java_ver:-fehlt}"
  printf 'gradle : %s\n' "${gradle_ver:-fehlt}"
  echo '```'
  echo
  echo "### Umfang"
  echo '```'
  printf 'Versionierte Dateien      : %s\n' "$(git ls-files 2>/dev/null | grep -c . || true)"
  printf 'Quellcode (scanbar)       : %s\n' "$(git ls-files 2>/dev/null | grep -icE '\.(py|js|mjs|cjs|ts|tsx|jsx|rs|kt|java|cpp|c|h|swift|go|gradle|kts|dart|cs|rb|php)$' || true)"
  printf 'Testdateien               : %s\n' "$(git ls-files 2>/dev/null | grep -cEi '(^|/)(test|tests|spec|__tests__)/|(_test|\.test|\.spec)\.' || true)"
  printf 'Dokumentation (Markdown)  : %s\n' "$(git ls-files 2>/dev/null | grep -cE '\.md$' || true)"
  echo '```'
  echo
} >> "$REPORT"

# ── Mocks / TODOs / Stubs ────────────────────────────────────────────────────
MARKER_HITS="$(scan "$COMMENT_MARKERS")"
MOCK_HITS="$(scan "$MOCK_IDENTS")"
{
  echo "## Mocks / TODOs / Stubs"
  echo
  echo "Zwei Signalklassen: Kommentar-Marker und Attrappen-Bezeichner."
  echo
} >> "$REPORT"
block "Kommentar-Marker: TODO|FIXME|MOCK|SHIM|STUB|PLACEHOLDER|HACK|XXX ($(printf '%s\n' "$MARKER_HITS" | grep -c . || true) Treffer)" \
      "$(printf '%s\n' "$MARKER_HITS" | head -100)"
block "Attrappen-Bezeichner: MOCK_*/MockX/PLACEHOLDER_*/FAKE_*/DUMMY_* ($(printf '%s\n' "$MOCK_HITS" | grep -c . || true) Treffer)" \
      "$(printf '%s\n' "$MOCK_HITS" | head -100)"

# ── Kandidaten-Tabelle je Datei ──────────────────────────────────────────────
{
  echo "### Kandidaten je Datei (automatisch vorsortiert)"
  echo
  echo "| Datei | Kandidaten-Status | Signale |"
  echo "|---|---|---|"
  git ls-files 2>/dev/null | grep -E '\.(py|js|mjs|cjs|ts|tsx|jsx|rs|kt|java|cpp|c|h|swift|go|gradle|kts|sh|dart|cs|rb|php)$' \
  | grep -vE "$SELF_FILES" | grep -vE "$TOOL_DIRS" | while read -r f; do
      [ -f "$f" ] || continue
      sig=(); status="REAL"
      # Testdateien dürfen Test-Doubles bauen (vi.fn().mockX, Mockito …) — kein Attrappen-Signal.
      if printf '%s' "$f" | grep -qEi '(^|/)(test|tests|spec|__tests__)/|(_test|\.test|\.spec)\.'; then
        is_test=1; else is_test=0; fi
      grep -qE "$COMMENT_MARKERS" "$f" 2>/dev/null && { sig+=("Kommentar-Marker"); status="TODO/FIXME"; }
      if grep -qE "$MOCK_IDENTS" "$f" 2>/dev/null; then
        if [ "$is_test" -eq 1 ]; then sig+=("Test-Double (ok)"); else sig+=("Mock-Bezeichner"); status="MOCK"; fi
      fi
      grep -qE "$NOT_IMPLEMENTED" "$f" 2>/dev/null && { sig+=("nicht implementiert"); status="STUB"; }
      # DEAD-Kandidat: Mock-Datei, deren Modulname nirgends importiert wird
      case "$f" in
        */mocks/*|*mock*|*Mock*)
          stem="$(basename "$f")"; stem="${stem%.*}"
          refs="$(grep -rlF "$stem" "${INCLUDES[@]}" "${EXCLUDES[@]}" . 2>/dev/null \
                  | sed 's|^\./||' | grep -v '^'"$f"'$' | grep -c . || true)"
          [ "$refs" -eq 0 ] && { sig+=("unreferenziert"); status="DEAD"; } ;;
      esac
      # Kandidat = jede Attrappe sowie alles, was vom REAL-Default abweicht.
      if [ "${#sig[@]}" -gt 0 ] && [ "$status" != "REAL" ]; then
        printf '| `%s` | %s | %s |\n' "$f" "$status" "$(IFS=', '; echo "${sig[*]}")"
      fi
    done
  echo
  echo "Nicht gelistet: Dateien ohne Attrappen-Signal (vorläufig \`REAL\`) sowie Werkzeugdateien,"
  echo "die die Suchmuster selbst enthalten (\`scripts/\`, \`tools/\`, \`tests/universe_harness.py\`)."
  echo "Dummy-Returns/\`pass\` allein machen noch keinen Kandidaten — siehe Dichte-Tabelle unten."
  echo
} >> "$REPORT"

# ── Leere Rümpfe / Dead Code ─────────────────────────────────────────────────
{
  echo "## Leere Rümpfe / Dead Code / Dummy-Returns"
  echo
} >> "$REPORT"
# `raise NotImplementedError` in abstrakten Methoden ist korrekt (ABC-Muster)
# und kein Attrappen-Signal — pro Datei die Zeilen davor prüfen.
NOT_IMPL_RAW="$(scan "$NOT_IMPLEMENTED")"
NOT_IMPL="$(printf '%s\n' "$NOT_IMPL_RAW" | while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"; rest="${hit#*:}"; line="${rest%%:*}"
  if [ -f "$file" ]; then
    start=$(( line > 3 ? line - 3 : 1 ))
    if sed -n "${start},${line}p" "$file" | grep -qE '@abstractmethod|abstractmethod'; then
      continue  # abstrakte Basisklasse: bewusst nicht implementiert
    fi
  fi
  printf '%s\n' "$hit"
done)"
block "Explizit nicht implementiert ($(printf '%s\n' "$NOT_IMPL" | grep -c . || true) Treffer)" \
      "$(printf '%s\n' "$NOT_IMPL" | head -60)"

# Leere Python-Rümpfe: def-Zeile, deren Rumpf nur pass/.../return None ist
EMPTY_BODIES="$(awk '
  /^[[:space:]]*(def|async def)[[:space:]]/ { prev=FNR; line=$0; next }
  { if (prev && FNR==prev+1) { if ($0 ~ /^[[:space:]]*(pass|\.\.\.)[[:space:]]*$/) print FILENAME":"prev": "line } }
' $(git ls-files '*.py' 2>/dev/null | grep -v '__pycache__' ) 2>/dev/null | head -40 || true)"
block "Python-Rümpfe mit nur pass/... ($(printf '%s\n' "$EMPTY_BODIES" | grep -c . || true) Treffer)" "$EMPTY_BODIES"

# Dummy-Return-Dichte je Datei — Signalstärke statt 300 Rohzeilen
DENSITY="$(scan "$DUMMY_RETURNS" | sed 's/:.*//' | sort | uniq -c | sort -rn | head -15 \
           | awk '{printf "%3d Signale  %s\n", $1, $2}')"
block "Dummy-Return-Dichte (Top 15 Dateien)" "$DENSITY"

{
  echo "Hinweis: \`return None/0/false\` und \`pass\` sind **kein** Beweis für Attrappen."
  echo "Bewertet wird im Kontext: Fehlerpfad, Fallback oder Platzhalter?"
  echo
} >> "$REPORT"

# ── Testdateien ──────────────────────────────────────────────────────────────
TEST_FILES="$(git ls-files 2>/dev/null | grep -Ei '(^|/)(test|tests|spec|__tests__)/|(_test|\.test|\.spec)\.' || true)"
{
  echo "## Testdateien"
  echo
  echo "Versionierte Testdateien: **$(printf '%s\n' "$TEST_FILES" | grep -c . || true)**."
  echo "Prüfen: echte Assertions? Ausführendes Kommando vorhanden?"
  echo
} >> "$REPORT"
block "Dateiliste" "$TEST_FILES"
TRIVIAL="$(grep -rnE "$TRIVIAL_TESTS" "${INCLUDES[@]}" "${EXCLUDES[@]}" . 2>/dev/null \
           | sed 's|^\./||' | grep -vE "$SELF_FILES" | grep -vE "$TOOL_DIRS" | head -30 || true)"
block "Scheintests (assert true / expect(true)) ($(printf '%s\n' "$TRIVIAL" | grep -c . || true) Treffer)" "$TRIVIAL"

# ── Test-Kommandos ───────────────────────────────────────────────────────────
{
  echo "## Ausführbare Test-/Build-Kommandos (Kandidaten für Schritt 5)"
  echo '```'
  if [ -f package.json ]; then
    python3 - <<'PY' 2>/dev/null || true
import json
try:
    s = json.load(open("package.json")).get("scripts", {})
    for k in ("test", "build", "lint", "type-check", "dev", "server"):
        if k in s:
            print(f"npm run {k:<12} -> {s[k]}")
except Exception:
    pass
PY
  fi
  [ -f Makefile ] && grep -E '^[a-zA-Z0-9_-]+:' Makefile | sed 's/:.*//' | sed 's/^/make /' || true
  [ -f android/gradlew ] && echo "./android/gradlew testDebugUnitTest    (Android SDK nötig)"
  [ -f wasm-ble/Cargo.toml ] && echo "cargo test --manifest-path wasm-ble/Cargo.toml"
  for d in server mobile-server desktop genesis-orchestrator/fastapi-backend; do
    [ -d "$d" ] && echo "python3 -m pytest $d   (bzw. python3 $d/tests/*.py)"
  done
  echo '```'
  echo
} >> "$REPORT"

# ── Nächste Schritte ─────────────────────────────────────────────────────────
{
  echo "## Nächste Schritte"
  echo
  echo "1. **Schritt 2 — Spezifikation:** README, \`docs/\`, GAP_MATRIX/ROADMAP gegen die Kandidaten abgleichen."
  echo "2. **Schritt 3 — Vervollständigen:** nur mit Backup (\`backups/\` bzw. \`repos/backups/<sha256>.bak\`),"
  echo "   gleiche API-Signatur, Marker \`// REAL-IMPLEMENTATION <datum>\`, Unit-Test ergänzen."
  echo "3. **Schritt 4 — Integration:** IPC/API/Events/DB/Queue triggern; externe Abhängigkeiten mit"
  echo "   Fallback + Timeout + Retry; State persistent statt nur In-Memory."
  echo "4. **Schritt 5 — Testen:** \`python3 tests/universe_harness.py\` (Stack-Erkennung, Build/Test, Health)."
  echo "5. **Schritt 7 — Bericht:** \`reports/universe-$(date '+%Y-%m-%d').md\` mit Fazit READY/PARTIAL/BLOCKED."
  echo
  echo "---"
  echo
  echo "_Erzeugt: $(date '+%Y-%m-%d %H:%M:%S %Z') · Werkzeuge: bash, git, grep, awk (keine externen Abhängigkeiten)_"
} >> "$REPORT"

echo "✅ Bericht: $REPORT"
echo "   Kandidaten: $(printf '%s\n' "$MARKER_HITS" | grep -c . || true) Marker · $(printf '%s\n' "$MOCK_HITS" | grep -c . || true) Mock-Bezeichner · $(printf '%s\n' "$NOT_IMPL" | grep -c . || true) nicht implementiert"
