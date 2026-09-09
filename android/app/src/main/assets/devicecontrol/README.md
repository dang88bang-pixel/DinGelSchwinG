# Assets: Device-Control-Binaries & Datenbanken

| Datei | Inhalt |
|---|---|
| `adb` | **Echtes ARM64-Binary** (aarch64/ELF, PIE), Quelle: [tytydraco/LADB](https://github.com/tytydraco/LADB), Apache-2.0 – läuft ohne Zusatzumgebung auf Android |
| `LICENSE-adb-ladb.txt` | Apache-2.0-Lizenztext der adb-Quelle (Attribution) |
| `fastboot` | Platzhalter – wird im CI-Build automatisch aus dem Termux-Paket `android-tools` ersetzt (Apache-2.0); lokal via `scripts/fetch-android-tools.sh` oder `FASTBOOT_URL=…` |
| `usb_vendors.json` | VID → Herstellername (SQLite-Befüllung der Port-View) |
| `supported_devices.json` | Marken-/Modell-Referenz + Fastboot-Support + Partitionsnamen |
| `rom_database.json` | Custom-ROMs + Geräteprofile (Codename, Flash-Methode, ARB-Hinweise) |
| `commands.json` | Vordefinierte Schnellwahl-Befehle der UI |

Die App erkennt Platzhalter am fehlenden ELF-Magic und meldet dann eine
klare Handlungsanweisung statt eines kryptischen Fehlers.
