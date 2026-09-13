# Termux-Anbindung — installieren, anbinden, verfügbar machen (2026-09-13)

**Auftrag:** „termux, termux-widget, termux-gataway installieren anbinden und verfügbar stellen"
**Branch:** `arena/01a09822-dingelschwing` · **Vorgänger:** `reports/universe-2026-09-13-schritt3.md`
**Regel:** Kein Eintrag ohne ausgeführten Beweis. Backups aller geänderten Dateien unter
`backups/phase3/` (Gateway/Server) und `backups/termux/` (Frontend/Workflow).

## Ergebnis in einem Satz

Termux, Termux:API, Termux:Widget und Termux:Boot sind **installierbar, angebunden und in der
laufenden App erreichbar**: ein idempotenter Installer richtet Pakete, 7 Widget-Startknöpfe,
Autostart und einen `termux-services`-Dienst ein; das Gateway spricht echte
`termux-*`-Prozesse über eine Whitelist an; das neue Panel **📟 Termux** zeigt Bestand, Live-Werte
und Aktionen — ohne Termux erscheint eine ehrliche Fehlermeldung mit Installationsanleitung,
keine erfundenen Werte.

## Was entstanden ist

| Baustein | Datei | Inhalt |
|---|---|---|
| Installer (Gerät) | `termux/install.sh` | Pakete (`python`, `termux-api`, `termux-services`, `termux-tools`), `~/.dgs/gateway.env` (600), `~/.shortcuts/`-Widgets, `~/.termux/boot/`-Autostart, Dienst `$PREFIX/var/service/dgs-gateway`; Optionen `--no-packages/--no-service/--no-boot/--force/--prefix`; idempotent |
| Dienststart | `termux/run-gateway.sh` | lädt `gateway.env`, prüft Python/Server, schreibt PID, Logs nach `~/.dgs/logs/`, `exec` ohne Shell-Wrapper |
| Widgets | `termux/shortcuts/*.sh` (7) | `10-gateway-status`, `11-gateway-start`, `12-gateway-stop`, `13-gateway-restart`, `14-selftest`, `15-termux-info`, `16-ble-scan` — Repo-Auflösung über `$DGS_REPO`/`$HOME`/Skriptpfad |
| Autostart | `termux/boot/10-dingelschwing-gateway.sh` | startet den Dienst nach Neustart (Termux:Boot) |
| Bridge (Backend) | `mobile-server/termux_bridge.py` | 17 freigegebene `termux-*`-Kommandos, `ARG_RULES` je Kommando, Widget-Läufer nur für `~/.shortcuts`, Symlink-Ausbruchschutz, Limits (8 s Kommando / 30 s Widget / 20 000 Zeichen), CLI `status·capabilities·widgets·run` |
| Gateway-Routen | `mobile-server/mobile_ble_server.py`, `gateway.py` | `GET /termux[?probe=1]`, `GET /termux/widgets`; `POST /command` mit `termux_status·termux_capabilities·termux_run·termux_widgets·termux_widget_run`; Zähler + Prometheus-Kennzahlen |
| App-Client | `src/lib/termux.ts` | HTTP-Vertrag des Gateways, ausschließlich über `/gateway/…` (Dev-Proxy/PortView), ehrliche Fehlerobjekte |
| App-Panel | `src/components/TermuxPanel.tsx`, registriert in `NetworkDashboard.tsx` | Anbindungsstatus, Live-Werte (Akku/WLAN), Aktionen, Widget-Start mit Argumenten, Kommando-Liste, Installationsanleitung, Roh-Ergebnis |
| MCP-Tools | `src/components/McpServerPanel.tsx` | 4 neue Gateway-Tools (`gateway_termux_status/_widgets/_widget_run/_run`) |
| Doku | `docs/termux.md` (+ README, `docs/INDEX.md`) | Installation, Widgets, Dienst/Boot, Verdrahtung, Routen, Whitelist/Grenzen, Env-Variablen, Tests |
| Tests | `mobile-server/tests/test_termux.py` (14), `src/lib/__tests__/termux.test.ts` (10), `src/components/__tests__/termuxPanel.test.ts` (4) | Bridge-/Routen-Vertrag, Client-Vertrag, Panel-Rendering + Verdrahtungs-Guard |
| CI | `.github/workflows/universe.yml` | eigener Schritt „Termux-Tests (mobile-server)" mit Annotationen bei Fehlschlag |

## Beweise

### 1. Testläufe (lokal, dieser Branch)

| Lauf | Ergebnis |
|---|---|
| `npm test` (Frontend) | **50/50** (7 Dateien) — davon 14 neue Termux-Tests |
| `python3 mobile-server/tests/test_termux.py` | **14/14** (u. a. „ohne Termux ehrlich", Symlink-Ausbruch, Whitelist) |
| `python3 mobile-server/tests/test_gateway.py` | **47/47** |
| `python3 mobile-server/mobile_ble_server.py selftest` | BESTANDEN |
| `python3 desktop/tests/test_core.py` · `python3 -m unittest discover -s server/tests` | 54/54 · 5/5 |
| `npm run type-check` · `npm run build` | ✅ · ✅ (36,8 s) |
| `bash scripts/universe_audit.sh` | 0 Marker · 0 nicht implementiert (3 Treffer = `vi.fn().mockResolvedValue`, Vitest-API) |
| `python3 tests/universe_harness.py --with-build --json reports/harness.json` | 8 Checks · ✅ 5 · ⏭ 3 · ⚠️ 0 · ❌ 0 → *PARTIAL* (übersprungen: Android-SDK, Python-Build) |

### 2. Installer im simulierten Termux

Präfix `/tmp/termux-sim/usr` mit echten ausführbaren Shell-Stubs (`termux-battery-status` …):

```
Termux: ja  ·  Termux:API erkannt  ·  Widgets: 7 angelegt  ·  Boot: ja
Selbsttest des Gateways: 24 Prüfungen bestanden
```

### 3. Live-Kette (Gateway :8791 → Bridge :8790 → Vite-Proxy :5173)

Browser-konforme Pfade, exakt wie das Panel sie aufruft:

```
GET  /gateway/termux?probe=1 → ok=true termux=true api=3/17 widgets=1
                               probes.battery = {percentage:91, temperature:30.2}
GET  /gateway/termux/widgets → 1 Widget (10-gateway-status.sh)
POST /gateway/command        → termux_widget_run: {"ok":true,"stdout":"Gateway-Status: ok (E2E-Test)\n"}
POST /gateway/command        → termux_run battery: argv=['termux-battery-status'], parsed={…91…}
POST /gateway/command        → termux_run shell: {"ok":false,"reason":"unbekanntes termux-kommando: 'shell'", …}
GET  /metrics                → termux_calls 2 · termux_errors 1 · termux_widget_runs 1
                               termux_available 1 · api_commands 3 · widgets 1
```

Der Abruf erfolgte **durch den Vite-Dev-Server** (`/gateway/…`), also über denselben Weg, den der
Browser/das WebView nimmt — kein `localhost` im Client. Ein Fehler wäre hier aufgefallen: der erste
Entwurf von `termux.ts` rief `/termux` (ohne `/gateway`-Präfix) auf und wäre am Proxy
vorbeigelaufen; die Korrektur ist per Test festgenagelt (`expect(url).toBe('/gateway/termux?probe=1')`).

### 4. Widgets und Dienst im Live-Lauf

Alle sieben Widget-Skripte wurden gegen das laufende Gateway ausgeführt, nicht nur
syntaxgeprüft. Dabei fielen **zwei echte Fehler** auf, die behoben und erneut geprüft wurden:

| Fehler | Ursache | Behebung / Beweis |
|---|---|---|
| `10-gateway-status.sh` zeigte „HTTP 8791 antwortet (JSON nicht lesbar)" | Heredoc (Programm) und Here-String (Daten) teilen sich denselben stdin → `python3 -` las das JSON als Programm | Daten per Umgebungsvariable `STATUS=… python3 - <<'PY'`; Live-Ausgabe jetzt: HTTP/Ports, **tatsächliches BLE-Backend**, Whitelist, Uptime, Termux-Block |
| `16-ble-scan.sh` ebenso | gleiches Muster (`python3 - <<'PY' <<<"$OUT"`) | `OUT=… python3 - <<'PY'`; Live-Ausgabe: `📡 2 Gerät(e) über mock` |
| Statusanzeige hätte „echtes BLE" behauptet | zeigte `config.mock` statt des aktiven Adapters — das Gateway fällt ohne `bluetoothctl` selbst auf `mock` zurück | Anzeige nutzt jetzt `ble.backend`; Live: `BLE: mock (Simulator) - Advertising an` |

Lebenszyklus in einem isolierten Lauf (eigene Ports 8891/8865/8890, eigener `HOME`):

```
11-gateway-start.sh   → ✅ Gateway gestartet (PID 6893)
10-gateway-status.sh  → Prozess: läuft (PID 6893) · HTTP ok auf :8891 · Termux ja · API 4/17 · Widgets 7
13-gateway-restart.sh → ✅ Gateway gestartet (PID 6923)
12-gateway-stop.sh    → ✅ Gateway gestoppt (danach keine Antwort auf :8891)
14-selftest.sh        → [selftest] BESTANDEN
15-termux-info.sh     → echtes JSON der Bridge (Termux ja, Präfix, API 4/17, fehlende Kommandos)
16-ble-scan.sh        → 📡 2 Gerät(e) über mock
```

## CI

| Lauf | Inhalt | Ergebnis |
|---|---|---|
| [34732498229](https://github.com/dang88bang-pixel/DinGelSchwinG/actions/runs/34732498229) | Inventar-Audit (Schritt 1) + Test-Harness (Schritt 5) auf `445ba8f` | ✅ Audit-Job grün, Harness-Job grün — inkl. neuem Schritt **„Termux-Tests (mobile-server)"** |

## Grenzen (bewusst offen)

1. **Echte Android-Hardware fehlt in dieser Umgebung.** Der Installer wurde in einem simulierten
   Termux-Präfix ausgeführt und geprüft; die Ausführung auf einem echten Gerät
   (CT45P/Xiaomi, F-Droid-Installation, Homescreen-Widget, Neustart-Autostart) ist der
   geräteseitige Rest und hier nicht reproduzierbar.
2. **Kein freies Shell-Kommando**: nur 17 Kommandos, SMS-Versand/Root/Anrufe bleiben gesperrt —
   das ist Absicht (Angriffsfläche), keine Lücke.
3. **`termux-services`/Termux:Boot** werden nur angelegt und — falls vorhanden — gestartet; ob
   Android die Dienste nach dem Neustart hochzieht, hängt an den Akku-Optimierungen des Geräts
   (in `docs/termux.md` beschrieben).

## Historien-Hinweis

Der Sandbox-Checkout startete als frischer Clone beim Basis-Commit `1044233`; die beiden
früheren Commits dieses Branches (`b15bf64`, `760b201`) waren lokal **nicht** vorhanden
(der erste `git ls-remote`-Blick war unvollständig abgeschnitten und legte fälschlich ein
Löschen des Branches nahe — der Branch war die ganze Zeit da). Sie wurden per
`git fetch origin <sha>` aus dem GitHub-Objektbestand zurückgeholt, der Branch per
`git reset --mixed 760b201` auf den echten Stand gesetzt und der Termux-Stand als eigener
Commit darauf gepusht — ein **Fast-Forward** (`760b201..02819b3`), keine Umschreibung der
Historie. Belege für die früheren Commits: CI-Läufe 34729762869 und 34729893759.

---

_Erzeugt am 2026-09-13 aus den echten Läufen dieses Branches._

**Fazit: READY** (CI-Lauf 34732498229 grün) (Code, Tests, Doku, Live-Kette und App-Panel belegt; geräteseitige Ausführung
braucht echte Termux-Hardware)
