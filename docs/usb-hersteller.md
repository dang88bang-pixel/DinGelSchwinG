# USB-Hersteller, Geräteabruf und Vorabprüfung („Brickschutz“)

Alles in diesem Dokument ist **read-only**. Die App und das Gateway benennen
Hersteller, listen ADB-Geräte und prüfen Voraussetzungen. Entsperrt, geflasht oder
umgangen wird hier nichts – siehe [Grenzen](#grenzen-warum-es-keinen-unlock-und-kein-imeei-gibt).

| Ebene | Datei | Was sie tut |
| --- | --- | --- |
| Daten | [`mobile-server/data/usb_vendors.json`](../mobile-server/data/usb_vendors.json) | 46 kuratierte VIDs (Android-OEMs + Honeywell/Zebra/Xiaomi/…) |
| Logik | [`mobile-server/vendors.py`](../mobile-server/vendors.py) | Parsing (usb.ids, udev-Regeln, adb_usb.ini, `adb devices -l`, `lsusb`), Lookup, Vorabprüfung, Selbsttest |
| Server | [`mobile-server/mobile_ble_server.py`](../mobile-server/mobile_ble_server.py) | Routen `/vendors`, `/devices/adb`, `/devices/usb`, `/devices/preflight`; Blöcke in `/status` + `/metrics` |
| App | [`src/lib/vendors.ts`](../src/lib/vendors.ts), [`src/components/IntegrationsPanel.tsx`](../src/components/IntegrationsPanel.tsx) | 🔌-Panel „Anbindungen“: Server/Ports, Geräte, Hersteller-Suche, Speicher, Vorabprüfung |
| Desktop | [`desktop/utils/clients.py`](../desktop/utils/clients.py), `desktop/utils/agent.py` | Chat-Befehle `hersteller 0x18d1`, `adb geräte`, `vorabprüfung …` |

## 1. Hersteller-Tabelle und woher die Namen kommen

Die mitgelieferte Tabelle ist **kuratiert und belegt** (`_meta.sources` in der JSON):
Android-Doku-Tabelle „USB Vendor IDs“, die Honeywell-Zuordnung `0x0c2e`
(Honeywell Scanning & Mobility, vormals Metrologic Instruments) und die gängigen
Community-Regelwerke (Xiaomi `0x2717`, OnePlus `0x2a70`, Oppo `0x22d9`, Fairphone
`0x2ae5`, Rockchip `0x2207`). Kein Abdruck der `usb.ids` – wer die **vollständige**
Liste will, gibt sie dem Gateway mit:

```bash
python3 mobile-server/mobile_ble_server.py --usb-ids /usr/share/hwdata/usb.ids
# oder als Dienst:  DGS_USB_IDS=/usr/share/hwdata/usb.ids
```

Reihenfolge der Schichten (spätere gewinnen, gebaut in `vendors.load()`):

1. `data/usb_vendors.json` (built-in, offline)
2. `~/.android/adb_usb.ini` und `51-android.rules` auf dem Host (Regelwerk ⇒ Name aus dem Kommentar)
3. `usb.ids` aus der Angabe `--usb-ids`/`DGS_USB_IDS`, sonst `/usr/share/hwdata/usb.ids`, `/usr/share/misc/usb.ids`

Konflikte werden nicht verschluckt: gewinnt eine Host-Quelle, bleibt der built-in
Name als `bundled_name` erhalten (prüft `test_usb_store_prefers_host_sources`).
Beispiel für einen echten Konflikt: `0x05e0` listen Community-Regelwerke als Zebra,
die `usb.ids` ordnet die SCM/Datalogic-Nachfolge zu – die lokale Datei entscheidet.

## 2. Endpunkte

| Methode | Pfad | Parameter | Antwort |
| --- | --- | --- | --- |
| `GET` | `/vendors` | – | `{ok, count, sources[], meta, vendors[]}` |
| `GET` | `/vendors` | `q=<name oder vid>` | `{ok, query, count, results[]}` |
| `GET` | `/vendors` | `vid=0x18d1[&pid=4e12]` | `{ok, device:{vid,pid,name,known,kind_label,adb_capable,via,note?}}` |
| `GET` | `/vendors` | `refresh=1` | Tabelle neu laden (neue Host-Dateien ohne Neustart) |
| `GET` | `/devices/adb` | – | `{ok, devices[], command}` · ohne adb: `{ok:false, error:"adb_nicht_verfuegbar", hint}` |
| `GET` | `/devices/usb` | – | `{ok, devices[], count}` aus `lsusb` · sonst `{ok:false, error:"lsusb_nicht_verfuegbar"}` |
| `GET` | `/devices/preflight` | `serial`, `modell`, `image`, `backup_dir`, `images_dir` | `{ok, verdict, checks[], devices[], target, adb, images_dir, note}` |

`/status` liefert zusätzlich `usb` (Größe, Quellen, adb-Pfad, Hinweis) und `stores`
(Whitelist/Audit/Sessions/Import-Katalog mit Pfad, Bytes, Dateizahl). `/metrics`:
`dingelschwing_gateway_usb_vendors`, `dingelschwing_gateway_adb_available`.

```bash
curl -s localhost:8791/vendors?vid=0x0c2e | python3 -m json.tool
curl -s "localhost:8791/devices/preflight?serial=CT45-01&modell=CT45&image=rom-ct45.zip"
```

## 3. adb auf der Wartungsstation (der Weg, der funktioniert)

`adb` läuft **auf dem Host des Gateways**, nicht im APK. Das ist kein Versehen: seit
targetSdk 29 verbietet Android `execve()` auf Dateien im App-Datenverzeichnis (W^X),
„`adb` aus `assets/` nach `filesDir` entpacken und `setExecutable(true)`“ ist damit
technisch tot – und ein `fastboot`-Zugriff vom unprivilegierten App-Kontext aus ist
nicht vorgesehen.

```bash
sudo apt install adb                 # bzw. platform-tools vom Android SDK
adb devices -l                       # Seriennummer, Modell, Transport
adb -s CT45-01 get-state
```

Linux braucht für Geräte ohne Google-Regelsatz manchmal udev-Regeln (`51-android.rules`,
`GROUP="plugdev"`). Die Datei ist zugleich eine Herstellerquelle für das Gateway (§ 1).

### Befehlsreferenz (alles lesend)

| Zweck | Befehl |
| --- | --- |
| Geräte + Details | `adb devices -l` |
| Hersteller/Modell | `adb -s <sn> shell getprop ro.product.manufacturer` · `ro.product.model` |
| OS-Stand | `adb -s <sn> shell getprop ro.build.version.release` · `ro.build.version.security_patch` |
| Bootloader-Zustand | `adb -s <sn> shell getprop ro.boot.verifiedbootstate` · `ro.boot.flash.locked` |
| Akku | `adb -s <sn> shell dumpsys battery` |
| ARB-Stand (Bootloader-Modus) | `fastboot getvar anti` |
| Image prüfen | `sha256sum -c rom.zip.sha256` |
| Daten sichern | `adb -s <sn> exec-out "tar -c /sdcard/Download" > backup.tar` (oder `adb backup`, Hinweis: OEM-Lock kann das blockieren) |
| WiFi-ADB | `adb tcpip 5555` · `adb connect <ip>:5555` – nur im eigenen Netz |

Das Gateway führt daraus **nur** `devices -l`, `getprop` und `dumpsys battery` aus
(feste Argumentliste, kein `shell=True`, Timeout über `DGS_ADB_TIMEOUT`, Standard 8 s).

## 4. Vorabprüfung = Checkliste, nicht Automation

`vendors.preflight()` läuft Prüfpunkte und liefert `verdict ∈ ok | attention | blockiert`.
Im Panel 🔌 „Anbindungen“ stehen die Punkte inklusive des jeweiligen Befehls und des
Behebungstextes – nützlich als Screenshot im Wartungsticket.

| Prüfpunkt | ok | warn | bad (⇒ blockiert) |
| --- | --- | --- | --- |
| `geraete` | Gerät `device` | `unauthorized`/`offline` | – |
| `serial` | ein Ziel eindeutig | – | mehrere Geräte ohne `serial`, falsche Seriennummer |
| `akku` | ≥ 50 % | 20–49 % | < 20 % |
| `bootloader` | `green` / `flash.locked=1` | entsperrt (`orange`) | – |
| `patch` | ≤ 400 Tage | älter/unlesbar | – |
| `modell` | erwartet = gemeldet | – | Abweichung |
| `image` | SHA-256 = `.sha256`-Begleiter | keine Begleitdatei | Hash passt nicht, Pfad außerhalb `images_dir`, Datei fehlt |
| `backup` | Backup jünger als 30 Tage | älter/keins | – |
| `arb` | Info: `fastboot getvar anti` | – | – |

Image-Dateien werden ausschließlich innerhalb `DGS_IMAGE_DIR` (Standard
`mobile-server/data/images`, CLI `--images-dir`) geprüft; `../`-Pfade quittiert die
Vorabprüfung mit `pfad_nicht_erlaubt`.

## 5. Grenzen: warum es keinen Unlock und kein IMEI gibt

Bewusst nicht implementiert, auch nicht auf Zuruf:

* **FRP-/_factory-reset_-Protection-Umgehung** – das ist das Aufhebeln einer
  Diebstahlsicherung. Zuständig sind OEM-Tools mit Nachweis der Geräteeigentümerschaft
  (Google „Find my device“, Samsung Find My Mobile, OEM-Service).
* **IMEI-Änderung/-„Reparatur“** – die IMEI ist eine eindeutige Geräteidentification.
  In Deutschland ist das nach § 269 StGB (Fälschung beweiserheblicher Daten)
  strafbarkeitsriskant, bereits der Versuch; in weiteren Staaten explizit verboten.
* **Bootloader-Unlock, Custom-ROM-/Recovery-Flashen aus der App** – permanenter
  Brick-Vektor (Anti-Rollback brennt unwiderruflich, `userdata`/`vendor` ohne
  Rückroute), Garantie-/Zertifizierungsfolgen (Widevine L1), und ohne Root gar nicht
  ausführbar. Fürs Werk: OEM-Werkzeug an der Wartungsstation, mit Prüfsumme und Protokoll.
* **„Apps ohne Bestätigung installieren“**, `READ_LOGS` für artfremde Apps,
  `MANAGE_DEVICE_ADMINS` als normale App-Permission – so nicht existent; Device-Admin
  braucht den `DevicePolicyManager`-Flow mit Nutzerzustimmung, seit Android 11 sind
  Paketabfragen außerdem auf `<queries>`-Einträge beschränkt.

Wenn eine Werkstatt echte Flash-Automatik braucht, ist der saubere Weg ein
**Workstation-Werkzeug** (Linux-Host, signierte Freigabeliste, Protokoll je Vorgang),
das über die bestehende PTY-/Bridge-Schiene angestoßen wird – nicht die App auf dem
Handy. Siehe [`docs/hardware-setup.md`](hardware-setup.md) (PTY-Bridge, udev) und
[`docs/production-backend.md`](production-backend.md).

## 6. Fehlerbehebung

| Bild | Ursache | Lösung |
| --- | --- | --- |
| `adb_nicht_verfuegbar` | kein adb auf dem Gateway-Host | `apt install adb`, oder `--adb-bin /pfad/zu/adb` / `DGS_ADB_BIN` |
| `lsusb_nicht_verfuegbar` | usbutils fehlen | `apt install usbutils` (nur für die Bus-Ansicht nötig) |
| Panel zeigt „adb meldet nichts“ | Gerät ab/USB-Debugging aus | Kabel, `adb kill-server && adb start-server`, Zustimmungsdialog am Gerät |
| `unauthorized` | RSA-Fingerprint nicht bestätigt | Am Gerät bestätigen – das ist gewollt, kein Workaround |
| `offline` | adb-Versionen gemischt, Tunnel weg | Host-`adb` aktualisieren, `adb devices` erneut, WiFi-ADB nur im eigenen Netz |
| `pfad_nicht_erlaubt` | Image außerhalb des freigegebenen Ordners | Image nach `--images-dir` legen (bewusste Kante, kein Bug) |
| Vorabprüfung „blockiert“ bei Modell/Hash | falsches oder korruptes Image | **Nicht** flashen; Download mit `.sha256` erneut holen, Modell abgleichen |
| App-Panel leer, obwohl Gateway läuft | Adresse nicht gesetzt | 🧭 PortView-Suchlauf, danach 🔌 neu laden |

## 7. Verifikation

```bash
python3 mobile-server/vendors.py                     # 9 Selbstprüfungen (Parsing, Prüfpunkte, Pfadschutz)
npm run mcp:vendors:selftest                         # derselbe Aufruf als Skript
npm run mcp:gateway:selftest                         # 24 Prüfungen, davon 5 für USB/Hersteller/Speicher
cd mobile-server && python3 tests/test_gateway.py    # 36/36, inkl. 4 Anbindungs-Tests
cd desktop && python3 -m unittest discover -s tests   # 50/50, inkl. TestUsbConnections
```
