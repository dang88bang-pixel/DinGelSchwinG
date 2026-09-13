# Termux-Anbindung (Termux · Termux:API · Termux:Widget · Termux:Boot)

<!-- REAL-IMPLEMENTATION 2026-09-13: Doku zur echten Anbindung — Installer,
     Bridge, Gateway-Routen, Panel, Widgets und Grenzen sind implementiert und
     getestet; nichts davon ist Attrappe. -->

Diese Anbindung macht das DinGelSchwinG-Gateway **auf dem Android-Gerät selbst**
lauffähig: Termux führt den Python-Gateway aus, Termux:API liefert echte
Gerätewerte (Akku, WLAN, Benachrichtigungen …), Termux:Widget legt Startknöpfe
auf den Homescreen, Termux:Boot startet alles nach einem Neustart.

```
┌──────────────────────── Android-Gerät ────────────────────────┐
│  Termux  ──  termux/run-gateway.sh                            │
│      │        └─ mobile-server/mobile_ble_server.py (BLE+HTTP) │
│      │                │  :8765 TCP   :8791 HTTP                │
│      ├─ Termux:API ────┘ (termux_bridge.py, Whitelist)         │
│      ├─ Termux:Widget ──► ~/.shortcuts/*.sh (7 Startknöpfe)    │
│      └─ Termux:Boot ────► ~/.termux/boot/10-dingelschwing-…    │
└───────────────────────────────────────────────────────────────┘
        ▲  HTTP /gateway/*   (Vite-Proxy → Bridge :8790 → Gateway :8791)
        │
   App/WebView (Termux-Panel) · Desktop · MCP-Bridge
```

## 1. Installation auf dem Gerät

Voraussetzungen: **F-Droid** (nicht Play Store) für Termux-Pakete.

1. Apps installieren: `Termux`, `Termux:API`, `Termux:Widget`, optional
   `Termux:Boot` (Autostart) und `Termux:Tasker`.
2. Repo ins Termux holen (`git clone …` oder `termux-setup-storage` + Kopie).
3. Installer ausführen:

```bash
cd ~/DinGelSchwinG
bash termux/install.sh                 # Pakete + Widgets + Dienst + Selbsttest
bash termux/install.sh --no-packages   # nur Dateien/Widgets (Pakete schon da)
bash termux/install.sh --no-service    # ohne termux-services-Autostart
bash termux/install.sh --no-boot       # ohne Termux:Boot-Skript
bash termux/install.sh --prefix /pfad  # anderes Repo-Verzeichnis
bash termux/install.sh --force         # ~/.dgs/gateway.env überschreiben
```

Der Installer ist **idempotent** (mehrfach ausführbar) und legt an:

| Datei / Ordner | Zweck |
| --- | --- |
| `~/.dgs/gateway.env` (`chmod 600`) | Ports, BLE-Backend, Datenablage, Widget-Ordner |
| `~/.dgs/data/` | Whitelist, Audit, Sessions (bleibt außerhalb des Repos) |
| `~/.dgs/logs/`, `~/.dgs/gateway.pid` | Logs und PID des Dienstes |
| `~/.shortcuts/*.sh` (7 Skripte) | Termux:Widget-Startknöpfe |
| `~/.termux/boot/10-dingelschwing-gateway.sh` | Autostart nach Neustart |
| `$PREFIX/var/service/dgs-gateway/{run,log/run}` | termux-services-Dienst |

Pakete: `python`, `termux-api`, `termux-services`, `termux-tools`
(`pkg install …`, über `--no-packages` überspringbar).

## 2. Widgets (Termux:Widget)

Nach der Installation: lange auf den Homescreen tippen → **Widgets** →
**Termux:Widget** → Skript auswählen.

| Skript | Wirkung |
| --- | --- |
| `10-gateway-status.sh` | Status + Ports + letzte Logzeilen (Kurzbericht im Toast) |
| `11-gateway-start.sh` | Gateway starten (Ports aus `~/.dgs/gateway.env`) |
| `12-gateway-stop.sh` | Gateway sauber stoppen (PID-Datei) |
| `13-gateway-restart.sh` | Neustart |
| `14-selftest.sh` | End-to-End-Selbsttest des Gateways |
| `15-termux-info.sh` | Termux-Umgebung, installierte `termux-*`-Kommandos, Widgets |
| `16-ble-scan.sh` | BLE-Scan in der Nähe (JSON) |

Die Skripte arbeiten ohne feste Pfade: sie finden das Repo über `$DGS_REPO`,
`$HOME/DinGelSchwinG` oder ihren eigenen Ablageort.

## 3. Dienst und Autostart

```bash
sv-enable dgs-gateway      # startet bei Termux-Start (termux-services)
sv up dgs-gateway          # jetzt starten
sv status dgs-gateway      # run: dgs-gateway: … (läuft)
sv down dgs-gateway        # stoppen
tail -f ~/.dgs/logs/sv/current   # Dienstlog (svlogd)
```

Ohne `termux-services`: `~/DinGelSchwinG/termux/run-gateway.sh &`
bzw. nach Neustart das Boot-Skript. Autostart über Termux:Boot greift nur, wenn
die App **einmal gestartet** und der Akku-Optimierung entzogen wurde.

## 4. Verdrahtung mit App, Desktop und Bridge

Alles läuft über relative Pfade, es gibt **kein `localhost` im Client**:

```
Browser/WebView  →  /gateway/termux          (Vite-Dev-Proxy)
                    /gateway/termux/widgets
                    /gateway/command         (POST, Aktionen)
                 →  Bridge :8790  →  Gateway :8791 (Termux)
```

Auf dem Desktop/Handy außerhalb des Dev-Servers setzt **PortView** die Basis
(`http://<gerät>:8791`) – dann greift `gatewayUrl()` direkt.

### HTTP-Routen des Gateways

| Route | Zweck |
| --- | --- |
| `GET /termux` | Bestandsaufnahme: `termux`, `prefix`, `api_present/api_total`, Widgets, Boot, `sv`, `hint` |
| `GET /termux?probe=1` | zusätzlich Live-Proben (`battery`, `wifi`) |
| `GET /termux/widgets` | Skripte in `~/.shortcuts` mit Name/Größe/Rechten |
| `POST /command` | Aktionen `termux_status`, `termux_capabilities`, `termux_run`, `termux_widgets`, `termux_widget_run` |

Beispiel:

```bash
curl -s  http://127.0.0.1:8791/termux?probe=1 | python3 -m json.tool
curl -s  http://127.0.0.1:8791/termux/widgets
curl -s -X POST http://127.0.0.1:8791/command -H 'Content-Type: application/json' \
     -d '{"action":"termux_run","command":"battery"}'
curl -s -X POST http://127.0.0.1:8791/command -H 'Content-Type: application/json' \
     -d '{"action":"termux_widget_run","widget":"16-ble-scan.sh"}'
```

### Überwachung

```
dingelschwing_gateway_termux_available 1        # läuft das Gateway in Termux?
dingelschwing_gateway_termux_api_commands 17    # installierte termux-*-Binaries
dingelschwing_gateway_termux_widgets 7          # Widget-Skripte
dingelschwing_gateway_termux_calls / _errors / _widget_runs   (Zähler)
```

### In der App

Panel **📟 Termux** im Dashboard (Navigation unten auf dem Handy, Button im
Header auf dem Desktop): Anbindungsstatus, Live-Werte (Akku/WLAN), Aktionen
(`info`, `battery`, `notify`, `wifi`, `toast`), Widget-Start mit Argumenten,
Liste der Termux:API-Kommandos, Installationsanleitung bei fehlendem Termux und
das rohe Ergebnis des letzten Aufrufs.

## 5. Whitelist und Grenzen (bewusst)

* **Nur freigegebene Kommandos** (17): `battery`, `clipboard_get`, `clipboard_set`,
  `info`, `location`, `notify`, `open_url`, `sensor_read`, `sensors`, `share`,
  `sms_list`, `telephony`, `toast`, `torch`, `vibrate`, `wifi`, `wifi_scan`.
  Alles andere wird mit `unbekanntes termux-kommando: '…'` **abgelehnt** – es
  gibt kein freies `shell`-Kommando.
* **Argument-Regeln je Kommando** (`ARG_RULES`): Whitelist erlaubter Parameter,
  Längen- und Zeichenbeschränkungen; Zahlenbereiche werden geprüft.
* **Widgets nur aus `~/.shortcuts`**: Name muss
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(sh|bash)$` erfüllen, Symlinks werden
  aufgelöst und dürfen das Verzeichnis **nicht verlassen**; Argumente
  `^[A-Za-z0-9._:/=+-]{0,64}$`.
* **Limits**: 8 s pro Termux:API-Kommando, 30 s pro Widget, Ausgabe auf 20 000
  Zeichen gekappt.
* **Ehrliche Fehler**: ohne Termux/`termux-api`/Gateway kommt keine erfundene
  Antwort, sondern `ok:false` + Grund + Hinweis (das Panel zeigt dann die
  Installationsanleitung).
* **Nicht abgedeckt**: Root-Aktionen, SMS-Versand, Anrufe, freie Shell-Befehle
  und Schreibzugriff außerhalb `~/.shortcuts` bleiben absichtlich gesperrt.

## 6. Umgebungsvariablen

| Variable | Bedeutung |
| --- | --- |
| `DGS_REPO` | Repo-Verzeichnis (Installer/Widgets/Run-Skript) |
| `DGS_TCP_HOST` / `DGS_TCP_PORT` | BLE-TCP (Standard `0.0.0.0:8765`) |
| `DGS_HTTP_PORT` | Gateway-HTTP (Standard `8791`) |
| `DGS_BLE_BACKEND` | `auto` \| `mock` \| `bluetoothctl` \| `gdbus` |
| `DGS_DATA_DIR` | Datenablage (Whitelist/Audit/Sessions) |
| `DGS_TERMUX_PREFIX` | Termux-Präfix (`/data/data/com.termux/files/usr`) |
| `DGS_TERMUX_WIDGET_DIR` | Widget-Verzeichnis (Standard `~/.shortcuts`) |

## 7. Tests und Wiederholung

```bash
python3 mobile-server/tests/test_termux.py     # 14 Prüfungen (Bridge + Routen)
python3 mobile-server/tests/test_gateway.py    # 47 Prüfungen (u. a. termux_*)
python3 mobile-server/mobile_ble_server.py selftest
python3 mobile-server/termux_bridge.py status  # CLI: status|capabilities|widgets|run
npm test                                       # Panel- und Client-Tests
```

Für Tests ohne Gerät lassen sich Präfix und Widget-Ordner umbiegen
(`DGS_TERMUX_PREFIX=/tmp/termux-sim/usr HOME=/tmp/termux-sim/home …`); die
Testdatei legt dafür echte, ausführbare Shell-Stubs an – kein `mock`-Zweig im
Produktivcode.
