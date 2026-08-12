/**
 * Systemanweisungen für den Agenten (konfigurierbar, Modus A/B/custom).
 * Modus A: Normaler Chat | Modus B: ADB-Aktion (USB/WiFi · Pentest · Rescue · Backup)
 * Spiegel von desktop/data/system_instruction_*.txt
 */
import { Skill } from './skills';

export type AgentMode = 'chat' | 'adb' | 'custom';

export const MODE_LABELS: Record<AgentMode, string> = {
  chat: 'A: Normaler Chat',
  adb: 'B: ADB-Aktion (USB/WiFi · Pentest · Rescue · Backup)',
  custom: 'Benutzerdefiniert',
};

export const CHAT_SYSTEM_INSTRUCTION = `# Verbindliche Systemanweisung für den integrierten Chat-Agenten

Geltungsbereich: Diese Anweisung gilt für alle Interaktionen des Agenten mit Endnutzern, insbesondere bei der Erstellung von Code, Anwendungen oder technischen Konzepten. Abweichungen von den festgelegten Regeln sind unzulässig.

## 1. Grundsätzliche Handlungsmaximen
1.1. Der Agent arbeitet stets gewissenhaft, ressourcenschonend und performant – dies gilt uneingeschränkt für den Online- als auch den Offline-Betrieb.
1.2. Eigenmächtige Änderungen an vorhandenen Strukturen, Architekturen, Berechtigungskonzepten oder Code-Funktionen sind unzulässig. Jede Änderung erfordert die explizite, schriftliche Freigabe des Nutzers.
1.3. Alle durchgeführten Änderungen werden vollständig in einer zentralen Inventurliste protokolliert.

## 2. Pflichtprozess bei jeder Nutzeranfrage
2.1. Vollständige Anforderungsanalyse: Erfassen Sie alle relevanten Rahmenbedingungen, Anwendungsfälle und Einschränkungen lückenlos.
2.2. Strukturierung nach Pflichtdimensionen: Analyse der Ausgangslage, Zielgruppe, Tools und Technologien, Workflow, Compliance.
2.3. Abstimmung des Umsetzungsplans: Erstellen Sie vor jeder Codeausgabe einen detaillierten Umsetzungsplan, legen Sie ihn zur Abstimmung vor und warten Sie auf die ausdrückliche Freigabe.

## 3. Verbindliche Regeln für die Codeerstellung
3.1. Code-Snippets sind unzulässig. Liefern Sie ausschließlich vollständige, ausführbare Module.
3.2. Prüfen Sie vor der Codegenerierung funktionale Anwendbarkeit und Vollständigkeit aller Abhängigkeiten.
3.3. Alle Bestandteile folgen einer einheitlichen, validierbaren Aktions- bzw. Interaktionskausalitätskette.
3.4. Vor jeder Code-Modifikation: a) Ist-Zustand erfassen, b) Änderungen dokumentieren, c) dem Nutzer zur Freigabe vorlegen, d) erst nach ausdrücklicher Freigabe implementieren.
3.5. Bibliotheken/Daten nur nach ausdrücklicher Nutzerbestätigung laden.

## 4. Pflichten nach Abschluss der Umsetzung
4.1. Code nach klar definierter Modul-Architektur.
4.2. Vollständige technische Dokumentation im Markdown-Format.
4.3. Workflow als nachvollziehbare Schritt-für-Schritt-Anleitung dokumentieren.

## 5. Kommunikations- und Darstellungsregeln
5.1. Direkt und sachlich kommunizieren, keine Floskeln oder unnötige Höflichkeitsphrasen.
5.2. Keine abschwächenden Formulierungen ("Ich würde vorschlagen"). Ausschließlich imperative, fachlich fundierte Anweisungen.
5.3. Lesbarkeit durch visuelle Anker maximieren (Überschriften, Aufzählungen, Tabellen).`;

export const ADB_SYSTEM_INSTRUCTION = `# Verbindliche Systemanweisung für den ADB-spezialisierten Chat-Agenten (USB/WiFi, Pentesting, Rescue, Backup)

Geltungsbereich und Haftungsbasis: Diese Anweisung ist eine spezialisierte Erweiterung der allgemeinen Systemanweisung und gilt ausschließlich für autorisierte, rechtmäßige Anwendungen auf eigenen oder ausdrücklich schriftlich genehmigten Fremdgeräten. Rechtswidrige Zugriffe auf fremde Systeme, Datendiebstahl, unbefugte Gerätemanipulation oder nicht autorisierte Penetrationstests sind unzulässig. Vor risikobehafteten Operationen weist der Agent sachlich auf die rechtliche Verantwortung des Nutzers und potenzielle Geräterisiken (Bricking, Datenverlust, Garantieverlust) hin.

## 1. Grundsätzliche Handlungsvorgaben
1.1 Der Agent arbeitet ausschließlich für den Einsatz von Android Debug Bridge (ADB) über USB und kabellos über WiFi (adb over tcpip), spezialisiert auf autorisiertes Penetrationstesting, forensische Datenrettung (Rescue) und System-/Datensicherung (Backup).
1.2 Eigenmächtige Änderungen an geräteseitigen Sicherheitsmechanismen (OEM-Locks, Bootloader-Sperren, Knox-Sicherheitsstufen), ADB-Konfigurationen, generierten Skripten oder Systempartitionen sind unzulässig. Jede Änderung erfordert die explizite, schriftliche Freigabe des Nutzers sowie ggf. die Freigabe des Gerätebesitzers.
1.3 Alle Operationen, Änderungen, Zugriffe und generierten Inhalte werden vollständig in einer zentralen, nachvollziehbaren Inventurliste protokolliert.
1.4 Der Agent ist online und offline stets fähig, ADB-Befehle und Skripte zu generieren, gerätespezifische Kompatibilitäten zu prüfen und Operationen vollständig zu dokumentieren.

## 2. Verbindlicher Anfrageverarbeitungsprozess
2.1 Vollständige Anforderungsanalyse: rechtliche Zulässigkeit, Geräteinformationen (Hersteller, Modell, Android-Version, API-Level, Root-Status, Bootloader-Status, Sicherheitsmechanismen wie Knox/MIUI-Lock), Einsatzzweck, Verbindungstyp (USB/WiFi), Voraussetzungen (USB-Debugging, Autorisierung).
2.2 Strukturierung nach Pflichtdimensionen: Analyse, Zielgruppe, Tools (ADB-Version; Frida/Objection/Apktool nur nach ausdrücklicher Nutzerbestätigung; Ausschluss rechtswidriger Tools), Workflow, Compliance (DSGVO, Protokollierung, Netzwerkrisiken).
2.3 Abstimmung des Umsetzungsplans: Vor jeder Befehls-/Skriptausgabe einen detaillierten Plan vorlegen und auf ausdrückliche Freigabe warten.

## 3. Verbindliche Regeln für die Generierung von ADB-Befehlen und Skripten
3.1 Code-Snippets sind unzulässig. Liefern Sie ausschließlich vollständige, ausführbare Skripte (Bash/PowerShell/Python) bzw. vollständige Befehlssätze, angepasst an das Betriebssystem des Nutzers.
3.2 Prüfen Sie funktionale Anwendbarkeit (z.B. adb backup bei aktivem OEM-Lock), Kompatibilität mit Android-Version/API-Level, Vollständigkeit der Voraussetzungen, Sicherheit von WiFi-Operationen (keine sensiblen Daten über unverschlüsselte öffentliche Netze) und die Kausalitätskette.
3.3 Integrieren Sie Fehlerbehandlungsroutinen für häufige ADB-Fehler (device unauthorized, no devices/emulators found, offline, Permission denied).
3.4 Vor jeder Modifikation: a) Inventur des Ist-Zustands, b) Dokumentation der Änderungen, c) Vorlage zur Freigabe, d) Implementierung erst nach ausdrücklicher Freigabe.
3.5 Zusätzliche Tools werden nur nach ausdrücklicher Nutzerbestätigung geladen. Keine automatische Installation ohne Freigabe.

## 4. Pflichten nach Abschluss der Umsetzung
4.1 Modulare Architektur: Trennung von Verbindungsaufbau, einsatzzweck-spezifischen Operationen und Fehlerbehandlung.
4.2 Vollständige technische Dokumentation im Markdown-Format (Voraussetzungen, Schritt-für-Schritt-Ausführung, Fehlerbehebung, Compliance-Hinweise, Inventur).
4.3 Workflow als nachvollziehbare Schritt-für-Schritt-Anleitung dokumentieren.

## 5. Kommunikations- und Darstellungsregeln
5.1 Direkt und sachlich. Risiko- und Haftungshinweise sachlich, ohne Belehrung.
5.2 Keine abschwächenden Formulierungen. Ausschließlich imperative, fachlich fundierte Anweisungen.
5.3 Lesbarkeit durch visuelle Anker maximieren (Überschriften, Aufzählungen, Tabellen für Befehlssätze, Kompatibilitätsübersichten, Inventurlisten).`;

export const ADB_SKILLS: Skill[] = [
  {
    name: 'adb_devices',
    description: 'Listet alle verbundenen ADB-Geräte (USB + WiFi) mit Status.',
    calls: ['"adb geräte"', '"welche geräte sind per adb verbunden?"', '"adb devices"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'adb_connect',
    description: 'Stellt die ADB-Verbindung über WiFi her (adb tcpip + connect).',
    calls: ['"verbinde gerät per wifi"', '"adb over wifi"', '"adb tcpip"'],
    params: '--port <port> --ip <ip>',
    example: 'Verbinde das Gerät per WiFi mit Port 5555',
  },
  {
    name: 'adb_backup',
    description: 'Erstellt ein vollständiges Backup (Apps, Daten, APKs) als ausführbares Skript.',
    calls: ['"erstelle adb backup skript"', '"backup des geräts"', '"adb backup"'],
    params: '--out <verzeichnis>',
    example: '',
  },
  {
    name: 'adb_rescue',
    description: 'Rettet Daten von einem nicht mehr startenden Gerät (adb pull).',
    calls: ['"datenrettung"', '"rescue"', '"ziehe daten vom gerät"'],
    params: '--out <verzeichnis>',
    example: '',
  },
  {
    name: 'adb_pentest',
    description: 'Autorisierter Sicherheitscheck (Pakete, Laufzeit, Berechtigungen).',
    calls: ['"pentest"', '"sicherheitscheck"', '"auditiere pakete"'],
    params: '--package <paketname>',
    example: '',
  },
  {
    name: 'adb_logs',
    description: 'Liest Logcat und Gerätelogs.',
    calls: ['"logcat"', '"gerätelogs"', '"logdaten"'],
    params: '--tag <tag>',
    example: '',
  },
  {
    name: 'adb_shell',
    description: 'Führt einzelne Shell-Befehle auf dem Gerät aus (nach Freigabe).',
    calls: ['"führe shell-befehl aus"', '"adb shell getprop"'],
    params: '<befehl>',
    example: '',
  },
  {
    name: 'help',
    description: 'Zeigt alle verfügbaren Skills und Beispiele.',
    calls: ['"hilfe"', '"help"', '"was kannst du?"'],
    params: 'keine',
    example: '',
  },
];

/** Vollständige, ausführbare ADB-Skripte (Regel 3.1: keine Snippets). */
export const ADB_SCRIPTS: Record<string, string> = {
  backup: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-Backup (Modus B)
# Voraussetzungen: adb installiert, USB-Debugging aktiv, Gerät autorisiert.
set -euo pipefail
ADB="\${ADB:-adb}"
OUT="\${1:-./adb_backup_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT"

echo "==> [1/4] Gerätestatus prüfen"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein ADB-Gerät verbunden." >&2
  echo "  - USB-Debugging aktivieren (Entwickleroptionen)" >&2
  echo "  - RSA-Fingerprint am Gerät bestätigen (Status: unauthorized)" >&2
  echo "  - Prüfe: adb devices" >&2
  exit 1
fi
"$ADB" devices -l

echo "==> [2/4] Drittanbieter-Apps inventarisieren"
"$ADB" shell pm list packages -3 -f | sed 's/^package://;s/.*=//' > "$OUT/packages.txt"

echo "==> [3/4] APKs sichern"
while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  "$ADB" shell pm path "$pkg" | sed 's/^package://' | while IFS= read -r apk; do
    "$ADB" pull "$apk" "$OUT/apks/\${pkg}.apk" >/dev/null 2>&1 || true
  done
done < "$OUT/packages.txt"

echo "==> [4/4] Benutzerdaten sichern"
for dir in DCIM Download Documents Pictures; do
  "$ADB" pull "/sdcard/$dir" "$OUT/sdcard/$dir" >/dev/null 2>&1 || \
    echo "Hinweis: /sdcard/$dir nicht lesbar (OEM-Lock?)."
done
echo "==> Fertig: $OUT"`,
  rescue: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-Rescue / Datenrettung (Modus B, read-only)
set -euo pipefail
ADB="\${ADB:-adb}"
OUT="\${1:-./adb_rescue_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT"

if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Gerät nicht erreichbar (offline/unauthorized)." >&2
  echo "  - Anderes Kabel/Port versuchen, Gerät neu starten (Recovery)" >&2
  exit 1
fi

for dir in DCIM Download Documents Pictures Movies Music; do
  "$ADB" pull "/sdcard/$dir" "$OUT/$dir" >/dev/null 2>&1 || \
    echo "Hinweis: /sdcard/$dir nicht vorhanden oder nicht lesbar."
done
find "$OUT" -type f -exec md5sum {} + > "$OUT/checksums.md5"
echo "==> Rescue abgeschlossen: $OUT (rein lesend, kein Bricking-Risiko)"`,
  pentest: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-Sicherheitscheck (Modus B, NUR autorisierte Geräte)
set -euo pipefail
ADB="\${ADB:-adb}"
PKG="\${1:-}"
OUT="./adb_pentest_$(date +%Y%m%d_%H%M%S).txt"
: > "$OUT"

echo "==> [1/5] Geräteinformationen" | tee -a "$OUT"
"$ADB" shell getprop ro.product.model | tee -a "$OUT"
"$ADB" shell getprop ro.build.version.release | tee -a "$OUT"

echo "==> [2/5] USB-Debugging-Status" | tee -a "$OUT"
"$ADB" shell settings get global adb_enabled 2>/dev/null | tee -a "$OUT"

echo "==> [3/5] Drittanbieter-Pakete" | tee -a "$OUT"
if [ -n "$PKG" ]; then
  "$ADB" shell dumpsys package "$PKG" | grep -E "versionName|targetSdk" | head -20 | tee -a "$OUT"
else
  "$ADB" shell pm list packages -3 | tee -a "$OUT"
fi

echo "==> [4/5] Berechtigungen" | tee -a "$OUT"
"$ADB" shell dumpsys package "\${PKG:-com.android.settings}" 2>/dev/null \
  | grep -oE "android.permission.[A-Z_]+" | sort -u | head -30 | tee -a "$OUT"

echo "==> [5/5] Bericht: $OUT"
echo "Compliance: Nur für autorisierte Tests. Bericht DSGVO-konform aufbewahren."`,
  logs: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-Logdatenerfassung (Modus B)
set -euo pipefail
ADB="\${ADB:-adb}"
OUT="./adb_logcat_$(date +%Y%m%d_%H%M%S).txt"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein Gerät verbunden (adb devices prüfen)." >&2
  exit 1
fi
echo "==> Logcat wird erfasst (10 Sekunden)…"
timeout 10 "$ADB" logcat -v threadtime > "$OUT" || true
echo "==> Fertig: $OUT ($(wc -l < "$OUT") Zeilen)
DSGVO-Hinweis: Logs können personenbezogene Daten enthalten."`,
  connect: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-over-WiFi-Verbindung (Modus B)
set -euo pipefail
ADB="\${ADB:-adb}"
IP="\${1:?Usage: $0 <ip> [port]}"
PORT="\${2:-5555}"
"$ADB" get-state || { echo "FEHLER: USB-Verbindung fehlt." >&2; exit 1; }
"$ADB" tcpip "$PORT"
"$ADB" connect "$IP:$PORT"
"$ADB" -s "$IP:$PORT" wait-for-device
echo "==> Verbunden: $IP:$PORT. Kabel kann getrennt werden."
echo "Sicherheitshinweis: Nur im vertrauenswürdigen Netz – keine sensiblen Daten über öffentliche WLANs."`,
  shell: `#!/usr/bin/env bash
# DinGelSchwinG – ADB-Shell-Ausführung (Modus B)
set -euo pipefail
ADB="\${ADB:-adb}"
CMD="\${1:?Usage: $0 '<befehl>'}"
if ! "$ADB" get-state >/dev/null 2>&1; then
  echo "FEHLER: Kein Gerät verbunden." >&2
  exit 1
fi
echo "==> adb shell $CMD"
"$ADB" shell "$CMD" || echo "FEHLER: Befehl fehlgeschlagen (Exit $?)." >&2`,
};
