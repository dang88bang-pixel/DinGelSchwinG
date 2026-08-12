# DinGelSchwinG Agent Console v3.0 – Skill-Definitionen (Modus C: BLE Professional Suite)
# Wird beim Start vom Agenten geladen (utils/skill_loader.py).

## ble_scan
Beschreibung: Startet/stoppt den kontinuierlichen BLE-Scan und zeigt die erkannten Geräte mit Klassifizierung.
Aufruf: "scanne ble" | "ble-geräte suchen" | "starte ble-scan" | "stoppe den ble-scan"
Parameter: keine (kontinuierlich, RSSI + Klassifizierung)
Beispiel: Scanne BLE nach Geräten in Reichweite

## ble_devices
Beschreibung: Zeigt alle erkannten BLE-Geräte (Klasse, RSSI, Hersteller, UUIDs, Provisionierungsstatus).
Aufruf: "zeige ble-geräte" | "welche ble geräte sind da?" | "ble devices"
Parameter: --class ntag|token|mesh|peripheral --min-rssi <dBm>

## ble_connect
Beschreibung: Verbindet ein Gerät (max. 20 parallele Verbindungen über den USB-C-Dongle).
Aufruf: "verbinde dich mit NTag-Tracker-Büro3-01" | "connecte TempSensor-Eingang"
Parameter: <gerätename>

## gatt_explore
Beschreibung: Zeigt alle GATT-Services, Characteristics und Descriptoren eines Geräts.
Aufruf: "zeige gatt dienste von X" | "gatt explorer" | "welche services hat X?"
Parameter: <gerätename>

## gatt_read
Beschreibung: Liest einen GATT-Wert und zeigt ihn in Hex, Dezimal, Binär und ASCII.
Aufruf: "lies batterie level" | "gatt read X"
Parameter: <gerät> <characteristic>

## gatt_write
Beschreibung: Schreibt einen Wert (hex) in eine GATT-Characteristic nach Freigabe.
Aufruf: "schreibe 0xBEEF in batterie-monitoring" | "gatt write X"
Parameter: <gerät> <characteristic> <hex-wert>

## ble_mesh_create
Beschreibung: Erstellt ein Mesh-Netzwerk inkl. Schlüsselverwaltung (Plan → Freigabe → Provisionierung).
Aufruf: "erstelle ein mesh-netzwerk" | "mesh für die tracker im büro 3"
Parameter: <name>
Beispiel: Erstelle ein Mesh-Netzwerk für die 4 erkannten Smart-Tracker im Büro 3

## ble_mesh_status
Beschreibung: Zeigt Mesh-Netzwerke, Knoten, Rollen, Pub/Sub-Adressen, TTL und Live-Status.
Aufruf: "mesh status" | "welche mesh netzwerke gibt es?"
Parameter: keine

## ble_configure
Beschreibung: Erstellt einen Konfigurationsablauf für ein Gerät (z. B. NTag Batterieüberwachung) und führt ihn nach Freigabe aus.
Aufruf: "konfiguriere den NTag-Tracker mit Seriennummer XY" | "batterieüberwachung aktivieren"
Parameter: <gerätename> [profil]
Beispiel: Konfiguriere den NTag-Tracker mit der Seriennummer XY für die Batterieüberwachung

## ble_test_suite
Beschreibung: Startet vordefinierte Test-Suiten (NTag, BLE-Token, Mesh, Performance) und wertet Ergebnisse aus.
Aufruf: "führe die ntag test-suite aus" | "regressionstest starten" | "test suite token"
Parameter: --suite ntag|token|mesh|performance

## ble_simulate
Beschreibung: Erstellt simulierte BLE-Geräte (max. 10) für Tests ohne physische Hardware.
Aufruf: "simuliere ein gerät" | "erstelle 3 simulierte token"
Parameter: --count <n> --class ntag|token|mesh|peripheral

## ble_profile
Beschreibung: Speichert oder wendet Konfigurationsprofile aus dem zentralen Profil-Cache an.
Aufruf: "speichere profil" | "wende profil X auf Y an" | "profile anzeigen"
Parameter: --save <name> | --apply <profil> <gerät>

## ble_audit
Beschreibung: Zeigt das BLE-Audit-Log (alle Scans, Verbindungen, Lese-/Schreibvorgänge, Agenten-Schritte).
Aufruf: "zeige ble audit" | "ble audit log"
Parameter: keine

## help
Beschreibung: Zeigt alle verfügbaren Skills und Beispiele.
Aufruf: "hilfe" | "help" | "was kannst du?"
Parameter: keine
