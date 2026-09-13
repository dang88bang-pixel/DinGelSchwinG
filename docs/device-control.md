# Device-Control-Subsystem (ADB/Fastboot, Port-View, ROM-Flashing)

Native Erweiterung der Android-App (Capacitor-Shell) um eine vollständige
**ADB-/Fastboot-Steuerzentrale** für das Honeywell CT45P – primäres Zielgerät:
Xiaomi 15 (HyperOS 2), sekundär: jedes Android-Gerät mit USB-Debugging.

> ⚠️ **Rechtlicher Rahmen:** Alle Flash-/Unlock-Funktionen sind ausschließlich
> für **eigene Geräte** bestimmt. **Nicht enthalten und bewusst nicht
> implementiert** sind IMEI-Reparatur (in der EU/DE illegal, § 108 TKG) und
> FRP-Bypass (umgeht den Diebstahlschutz von Google). Bootloader-Unlock und
> Custom-ROM-Flashing können Garantie kosten und Daten löschen – die App
> erzwingt dafür Pre-Flash-Checks und ausdrückliche Bestätigungen.

---

## 1. Architektur

```
android/app/src/main/java/com/dingelschwinng/moeagent/devicecontrol/
├── AdbWrapper.kt            # eingebettetes ARM64-adb, Whitelist, Timeouts
├── FastbootWrapper.kt       # eingebettetes ARM64-fastboot
├── DeviceManager.kt         # automatische Port-View (USB-Host + ADB, live)
├── ToolManager.kt           # ADBify/Bugjaeger: Erkennung + Play Store + Intents
├── CommandParser.kt         # Sprach-Kommandos (DE/EN) → ADB/Fastboot
├── DeviceControlActivity.kt # native Konsole: Port-View + Chat
├── DeviceControlPlugin.kt   # Capacitor-Brücke für die Web-Schicht
├── AdminReceiver.kt         # optionaler Device-Admin (CT45P-Flotte)
├── db/
│   ├── UsbVendorDatabase.kt # VID → Herstellername (SQLite, aus JSON-Asset)
│   └── DeviceHistoryDb.kt   # Geräte-Historie, Favoriten, Flash-Protokoll
├── flash/
│   ├── BrickProtectionManager.kt  # Anti-Rollback (ARB/eFuse)-Prüfung
│   ├── FlashSafetyChecker.kt      # Pre-Flash-Checkliste (6 Punkte)
│   ├── BackupManager.kt           # Backup-Pflicht + Checkliste
│   └── FlashSetupWizard.kt        # 5-Schritte-Assistent
├── models/Models.kt
├── rom/RomRepository.kt     # ROM- + Geräteprofil-Datenbank
└── utils/                   # ProcessUtils, FileUtils (SHA-256), PermissionUtils
```

Assets (`android/app/src/main/assets/devicecontrol/`):

| Datei | Zweck |
|---|---|
| `adb`, `fastboot` | ARM64-Binaries (ab Werk Platzhalter, s. Installation) |
| `usb_vendors.json` | ~40 Hersteller-Vendor-IDs für die Port-View |
| `supported_devices.json` | 14 Marken, ~120 Modelle, Fastboot-Support, Partitionen |
| `rom_database.json` | 8 Custom-ROMs + 10 Geräteprofile (Codename-basiert) |
| `commands.json` | Schnellwahl-Befehle der UI |

---

## 2. Installation & Binaries

Das Repo wird mit einem **echten ARM64-`adb`** ausgeliefert (Quelle:
[tytydraco/LADB](https://github.com/tytydraco/LADB), Apache-2.0, Attribution
in `assets/devicecontrol/LICENSE-adb-ladb.txt`). Für `fastboot` liegt ein
Platzhalter bei – er wird automatisch ersetzt:

- **CI/CD** (GitHub Actions `build-apk.yml`): Der Schritt *„Fetch Device-Control
  binaries“* lädt vor jedem Build das Termux-Paket `android-tools`
  (SHA-256-geprüft); schlägt der Download fehl, bleibt der Platzhalter
  (fail-soft) und die APK ist trotzdem installierbar.
- **Lokal:**

```bash
bash scripts/fetch-android-tools.sh          # füllt fehlende Binaries auf
# oder eigene/geprüfte ARM64-Builds (höchste Priorität):
ADB_URL=https://…/adb FASTBOOT_URL=https://…/fastboot \
  bash scripts/fetch-android-tools.sh
# vorhandene Binaries werden nie überschrieben, außer mit FORCE=1

cd android && ./gradlew assembleRelease
```

Ohne Binaries läuft die App normal weiter – jeder ADB/Fastboot-Aufruf meldet
dann eine klare Handlungsanweisung („Platzhalter erkannt“). Die Erkennung
läuft über das ELF-Magic der Dateien, nicht über Dateinamen.

**Vorbehalt zum Termux-fastboot:** Termux-Binaries sind für die Termux-Laufzeit
gelinkt und starten nicht auf jedem Gerät ohne diese. Für den produktiven
Einsatz eigene statische ARM64-Builds per `FASTBOOT_URL` einspielen. adb ist
davon nicht betroffen (LADB-Build läuft ohne Zusatzumgebung).

---

## 3. Konfiguration der Geräte

### Steuergerät (Honeywell CT45P)
1. App installieren (signiertes Release-APK).
2. USB-OTG: Steuergerät erkennt angesteckte Android-Geräte automatisch
   (`usb_device_filter.xml` deckt alle gängigen Android-Vendor-IDs ab).
3. Optional: Device-Admin aktivieren (Einstellungen → Sicherheit →
   Geräteadministratoren) – nur für Flottenbetrieb (Sperren/Wipe des
   Steuergeräts selbst).

### Zielgerät (z. B. Xiaomi 15)
1. Entwickleroptionen → **USB-Debugging** aktivieren.
2. Gerät per USB-C/OTG verbinden → auf dem Zielgerät die ADB-Freigabe
   bestätigen („Diesem Computer immer erlauben“).
3. WLAN-ADB alternativ: `verbinden <IP>` im Chat (Zielgerät braucht vorher
   `adb tcpip 5555` oder aktives „Wireless Debugging“).
4. Für Flashing zusätzlich: Bootloader-Unlock des Herstellers
   (Xiaomi: Mi-Unlock-Portal mit Wartezeit; Google/Pixel: direkt per
   `flashing unlock`).

---

## 4. Befehl-Referenz (Chat)

Die native Konsole (Device-Control-Activity) und die Web-Schicht
(`DeviceControl.parseCommand()`) verstehen:

| Befehl | Wirkung |
|---|---|
| `geräte` / `devices` | verbundene Geräte inkl. Status (✅/⚠️/❌) |
| `verbinden <IP> [Port]` | ADB-over-WLAN (Standardport 5555) |
| `install <APK-Pfad>` | App installieren (`install -r`) |
| `deinstall <paket>` | App deinstallieren |
| `cache löschen <paket>` | App-Daten zurücksetzen (`pm clear`) |
| `shell <befehl>` | Shell-Befehl auf dem Zielgerät |
| `push <lokal> <remote>` / `pull <remote>` | Dateitransfer |
| `logs` / `logcat` | letzte 200 Log-Zeilen |
| `akku` | Akkustand des Zielgeräts |
| `screenshot` | Screenshot nach `/sdcard/screenshot.png` |
| `reboot` | Zielgerät neu starten |
| `adb <…>` / `fastboot <…>` | direkte Befehle (Verb-Whitelist!) |
| `adb-server restart` | ADB-Server neu starten (Fehlerbehebung) |
| `bugjaeger` / `adbify` | externe Tools starten bzw. Play Store öffnen |
| `hilfe` | diese Liste |

**Kein Freiform-Fallback:** Unbekannte Eingaben landen in der Hilfeseite.
Direkte Befehle werden gegen eine Whitelist geprüfter Unterbefehle gefiltert
(adb: `devices, connect, shell, install, push, pull, logcat, reboot, …`;
fastboot: `devices, flash, getvar, reboot, flashing, oem, …`).

### Flashing läuft ausschließlich über den Assistenten

`wizardSteps / wizardPrepare / wizardUnlock / preFlashCheck` (Web) bzw. die
Schritte des `FlashSetupWizard` (nativ):

1. **prepare** – Geräte-Infos, Backup-Checkliste
2. **unlock** – nur mit `confirmed=true` UND bestandener Geräte-Erreichbarkeit
3. **recovery** – optionales Custom Recovery (SHA-256-geprüft)
4. **flash** – Partition für Partition aus dem Geräteprofil; jede Partition
   durchläuft vorher die komplette Pre-Flash-Prüfung
5. **finish** – Neustart, Eintrag in die `flash_history`-Datenbank

---

## 4a. ADB-Ausführung aus dem Web (Backend-Träger, A-5)

Der Browser hat kein USB/ADB. Seit Aktionskette **A-5** führt das **Backend**
freigegebene Verben aus, sobald dort ein Träger läuft — sonst bleibt es beim
gewohnten Plan + ausführbaren Skript (`adb_<art>_<zeitstempel>.sh`), und die
Antwort sagt das offen (HTTP 501 `KEIN_ADB_TRAEGER`, kein erfundener Exit-Code).

| Endpunkt | RBAC | Zweck |
|---|---|---|
| `GET /api/adb/status` | `adb.read` (operator) | Träger, Verb-Whitelist, Read-only-Liste für `adb shell` |
| `POST /api/adb/run` | `adb.run` (service) | Verb ausführen; Risiko-Verben nur mit `approve: true` |
| `POST /api/adb/carrier` | `adb.carrier` (service) | entfernten Träger registrieren (nur mit `NEXUS_ADB_REMOTE=1`) |

**Verb-Whitelist** (`server/adb.py` — argv ohne Shell, Seriennummer-Muster, Timeout):

| Verb | serial | Argumente | Risiko | Timeout |
|---|---|---|---|---|
| `devices` | – | – | nein | 15 s |
| `logcat` | optional | `tag`, `lines` | nein | 30 s |
| `shell` | Pflicht | `command` — nur Read-only (`getprop`, `pm list packages`, `pm list permissions`, `dumpsys battery`, `settings get`, `ls`, `df`, `uptime`, `cat /proc/version`, `id`) | nein | 30 s |
| `pull` | Pflicht | `remote` (absoluter Gerätepfad), `local` (bleibt in `server/data/adb/`) | nein | 120 s |
| `connect` / `disconnect` | – | `ip` (`host[:port]`) | nein | 20 s |
| `install` | Pflicht | `apk` (Datei aus `server/data/adb/`, `-r`) | **ja** | 180 s |
| `uninstall` | Pflicht | `package` | **ja** | 60 s |
| `reboot` | Pflicht | `mode` (`bootloader` oder `recovery`) | **ja** | 30 s |
| `tcpip` | Pflicht | `port` (1–65535) | **ja** | 30 s |

**Träger einrichten**

```bash
# Variante 1 — ein adb-Binary auf dem Backend-Host (PATH oder explizit):
NEXUS_ADB=/pfad/zum/adb NEXUS_PORT=5000 python3 server/app.py

# Variante 2 — ein anderer Host führt aus (z. B. die Werkstatt-Desktop).
# Ohne NEXUS_ADB_REMOTE=1 ist dieser Weg zu (403 REMOTE_TRAEGER_DEAKTIVIERT).
NEXUS_ADB_REMOTE=1 NEXUS_PORT=5000 python3 server/app.py
curl -X POST http://127.0.0.1:5000/api/adb/carrier \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"desktop-werkstatt","endpoint":"http://127.0.0.1:8787/adb"}'
# Der Eintrag gilt 120 s (ttl); danach zählt er nicht mehr als Träger.
```

**Träger-Vertrag** — was ein entfernter Host beantworten muss (die Desktop-Konsole
oder ein Termux-Host können ihn später bedienen; geprüft wird er heute per
HTTP-Stub in `server/tests/test_adb_proxy.py`):

```http
POST <endpoint>                      # vom Backend an den Träger gesendet
{ "verb": "devices", "serial": "", "args": {}, "argv": ["adb", "devices", "-l"], "timeout": 15.0 }

200 { "exitCode": 0, "output": "List of devices attached" }
    { "exitCode": 1, "output": "adb: device not found", "error": "…" }   # Fehler bleiben Fehler
```

Der Träger führt `argv` aus (ohne Shell) und meldet den **echten** Exit-Code;
das Backend ergänzt Träger-Name, Dauer, Kürzung und Audit. Ist der Träger nicht
erreichbar oder antwortet er mit HTTP-Fehler, steht im Befund
`traeger-nicht-erreichbar` bzw. `traeger-fehler` — niemals ein erfundener Erfolg.

**Im Web-Chat** werden daraus echte Aufrufe: `adb devices`,
`adb -s <serial> logcat lines=200 tag=System`,
`adb shell getprop ro.build.version.sdk`, `adb connect 192.168.1.20:5555`,
`adb pull /sdcard/DCIM dcim`. Risiko-Verben (`adb reboot bootloader`,
`adb install app.apk`) legen zuerst einen Umsetzungsplan an — ausgeführt wird
erst nach „freigeben“ (dann mit `approve: true`). Verben außerhalb der
Whitelist (z. B. `adb backup`, `adb push`) bleiben beim Plan + Skript, weil
das Backend sie nicht ausführt.

**Antwort-Inhalt:** mit Träger Exit-Code, `argv`, Träger (`local`/`remote`),
Dauer und Ausgabe (gekürzt auf 20 000 Zeichen); ohne Träger der 501-Grund, der
lokal ausführbare Befehl und — wo eine Skript-Art passt (`logcat`→logs,
`pull`→rescue, `shell`→shell, `connect`/`tcpip`→connect) — das fertige Skript.
Jeder Aufruf schreibt `adb_run` (`<verb> exit=<code> <grund>`) bzw.
`adb_carrier` ins Audit; `GET /api/audit` zeigt den Exit-Code.

**Tests:** `server/tests/test_adb_proxy.py` (32 Tests: Whitelist, Muster,
Freigabe, 501 ohne Träger, echte Exit-Codes/Timeouts über ein Fake-`adb`,
entfernter Träger per HTTP-Stub, RBAC, Live-Endpunkte inkl. Audit) und
`src/lib/agent/__tests__/adbProxy.test.ts` (16 Tests: Satz→Antrag, Ausführung
mit Träger, Freigabe-Dialog, 501 → Plan + Skript).

---

## 5. Brick-Schutz

| Mechanismus | Umsetzung |
|---|---|
| Anti-Rollback (ARB) | `BrickProtectionManager`: liest `ro.boot.anti_rollback`, blockiert Ziel-ROMs mit niedrigerer ARB-Version (eFuse-Risiko) |
| Pre-Flash-Checkliste | `FlashSafetyChecker`: Erreichbarkeit, Bootloader-Status, SHA-256, Codename-Kompatibilität (`ro.product.device` vs. Profil), ARB, Akku ≥ 60 % |
| Backup-Pflicht | `BackupManager`: `adb backup` + manuelle Checkliste (2FA-Codes, Fotos, …) |
| Abbruch-Kette | schlägt **eine** Partition fehl, wird der Flash sofort gestoppt |
| Protokoll | jeder Vorgang landet in `flash_history` (SQLite) |

---

## 6. Externe Tools (ADBify, Bugjaeger)

| Tool | Integration |
|---|---|
| **ADBify** (`com.justunes.adbify`) | Installationsprüfung, Play-Store-Button, App-Start per Launch-Intent |
| **Bugjaeger** (`eu.hackenberger.bugjaeger`) | wie oben, zusätzlich Serial-Extra für direktes USB-OTG-Debugging, Screenshots, Logcat-Viewer, Installation ohne Bestätigungsdialog |

Es werden **keine** Binaries oder APIs dieser Apps extrahiert/reimplementiert –
die Integration läuft ausschließlich über PackageManager-Erkennung und Intents.
ChimeraTool hat keine öffentliche Android-App; die „ChimeraTool-artige“
Modellliste wird durch `supported_devices.json` lokal abgebildet.

---

## 7. Automatische Port-View

`DeviceManager` vereint zwei Quellen live (BroadcastReceiver für
`USB_DEVICE_ATTACHED/DETACHED`, kein Polling):

1. **USB-Host-API** (`UsbManager.getDeviceList()`) → VID/PID, Herstellername
   aus der `usb_vendors`-SQLite (→ „Xiaomi“ statt „0x2717“)
2. **`adb devices`** → Serial + Zustand (`device`/`unauthorized`/`offline`)

Statusfarben: 🟢 verbunden · 🟡 nicht autorisiert · ⚪ kein ADB/andere Geräte.
Jedes gesehene Gerät wird in `device_history` protokolliert (Zeitpunkt,
Verbindungszähler, letzter Zustand).

---

## 8. Capacitor-API (Web-Schicht)

In `src/` (React) ohne weitere Bindings nutzbar:

```ts
import { registerPlugin } from '@capacitor/core';
const DeviceControl = registerPlugin('DeviceControl');

await DeviceControl.status();                    // Binaries, DB-Umfang
await DeviceControl.portView();                  // USB + ADB vereint
await DeviceControl.parseCommand({ input: 'geräte' });
await DeviceControl.preFlashCheck({
  serial: '…', profileId: 'xiaomi_houji',
  romPath: '/data/…/boot.img', sha256: '…', targetArb: '4'
});
await DeviceControl.openConsole();               // native Konsole öffnen
```

Vollständige Methodenliste: `DeviceControlPlugin.kt` (Kopfkommentar).

Typisierte Gegenstelle für die React-Oberfläche: `src/lib/deviceControl.ts`.
Sie spricht in der Capacitor-Hülle das native Plugin an und fällt im Browser
(Dev-Server / PWA) auf einen Datenbank-Modus zurück, der die **realen** JSON-
Datenbanken aus `public/devicecontrol/*` (identische Kopien der App-Assets) liest.
Aktionen, die echte USB-Prozesse brauchen, liefern im Browser eine klare
„nur nativ“-Meldung statt zu simulieren.

---

## 8a. Bedienoberfläche in der App (React-Panels)

Zwei Panels sind über die Header-Leiste (bzw. die mobile Schnellwahl unten links)
erreichbar:

- **📱 Geräte** (`src/components/DevicePortViewPanel.tsx`) — die automatische,
  sich selbst aktualisierende **Geräte-Port-View**: alle über USB/ADB gefundenen
  Geräte mit Label/Modell, Serial, Hersteller (aus der VID/PID-Datenbank),
  VID/PID, Verbindungstyp und Farbstatus (🟢/🟡/🔴). Auto-Refresh alle 4 s.
  Zusätzlich zeigt es transparent **alle Anbindungen** — Tools (Platform-Tools,
  ADBify, Bugjaeger), Bibliotheken (Brick-Schutz), Datenbanken (ChimeraTool-
  Modellreferenz, USB-Vendor-DB, ROM-/Geräteprofil-DB, Geräte-Historie), APIs
  (USB-Host) und Protokolle (ADB/Fastboot) — sowie den Engine- und Tool-Status.
- **🚀 Flash** (`src/components/FlashCenterPanel.tsx`) — das **Flash-Center** für
  gerätespezifisches Custom-OS-Flashing mit Brick-Schutz in vier Schritten:
  1. Gerät + Custom-OS aus der realen ROM-/Geräteprofil-DB wählen (zeigt
     Flash-Methode, Unlock-Pflicht, Partitionen, ARB-Warnung);
  2. Brick-Schutz-Report (ARB/Firmware/Bootloader) lesen;
  3. Pre-Flash-Check (6 Punkte) — blockiert bei Risiko;
  4. 5-Schritte-Einrichtungsassistent mit ausdrücklicher Datenverlust-
     Bestätigung, Backup-Checkliste und Live-Protokoll.
  Der rechtliche Rahmen (nur eigene Geräte; kein IMEI-Repair / FRP-Bypass) wird
  prominent angezeigt.

---

## 9. Fehlerbehebung

| Symptom | Lösung |
|---|---|
| „adb-Binary ist ein Platzhalter“ | `scripts/fetch-android-tools.sh` ausführen, neu bauen |
| `unauthorized` in der Port-View | ADB-Freigabe auf dem Zielgerät erneut bestätigen; Kabel tauschen |
| keine USB-Erkennung | CT45P: OTG-Modus prüfen; App neu starten (Broadcast-Registrierung) |
| ADB antwortet nicht | `adb-server restart` im Chat; danach Geräte neu anstecken |
| Unlock „failed“ | Hersteller-Portal nötig (Xiaomi: Mi Unlock mit Wartezeit); Gerät muss im Fastboot-Modus sein (Volume-down + Power) |
| ARB-Fehler beim Flash | Ziel-ROM mit ARB-Version ≥ Geräte-ARB verwenden; niemals downgraden |
| Termux-Binary startet nicht | Variante B (eigene statische Builds) verwenden, s. Abschnitt 2 |
| `getvar unlocked` leer | Gerät ist nicht im Fastboot-Modus (ADB-Modus ≠ Fastboot) |

### Test-Checkliste
```
□ adb/fastboot-Binaries sind echte ELFs (status() → adbReady/fastbootReady)
□ USB-Host-Modus aktiv (OTG-Kabel am CT45P)
□ Zielgerät verbunden & autorisiert (Port-View zeigt 🟢)
□ Vendor-DB befüllt (status() → vendorDbSize > 0)
□ ADBify/Bugjaeger-Erkennung zeigt korrekten Installationsstatus
□ preFlashCheck blockiert manipulierte SHA-256 zuverlässig
□ wizardUnlock verweigert ohne confirmed=true
□ Flash-Historie enthält Eintrag nach Testlauf
□ Web (A-5): GET /api/adb/status zeigt carrier=null, wenn kein Träger läuft
□ Web (A-5): POST /api/adb/run → 501 KEIN_ADB_TRAEGER ohne Träger (Web bleibt bei Plan + Skript)
□ Web (A-5): mit Träger Exit-Code 0 in der Antwort und adb_run-Eintrag im Audit
□ Web (A-5): Risiko-Verb ohne approve=true → 403 FREIGABE_NOETIG
```
