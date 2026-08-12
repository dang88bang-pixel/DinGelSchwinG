# DinGelSchwinG ADB-Skills (Modus B – Aktion)
# Gilt ausschließlich für autorisierte, rechtmäßige Anwendungen auf eigenen
# oder ausdrücklich schriftlich genehmigten Fremdgeräten.

## adb_devices
Beschreibung: Listet alle verbundenen ADB-Geräte (USB + WiFi) mit Status.
Aufruf: "adb geräte" | "welche geräte sind per adb verbunden?" | "adb devices"
Parameter: keine

## adb_connect
Beschreibung: Stellt die ADB-Verbindung über WiFi her (adb tcpip + connect).
Aufruf: "verbinde gerät per wifi" | "adb over wifi" | "adb tcpip"
Parameter: --port <port> --ip <ip>
Beispiel: Verbinde das Gerät per WiFi mit Port 5555

## adb_backup
Beschreibung: Erstellt ein vollständiges Backup (Apps, Daten, APKs) als ausführbares Skript.
Aufruf: "erstelle adb backup skript" | "backup des geräts" | "adb backup"
Parameter: --out <verzeichnis>

## adb_rescue
Beschreibung: Rettet Daten von einem nicht mehr startenden Gerät (adb pull).
Aufruf: "datenrettung" | "rescue" | "ziehe daten vom gerät"
Parameter: --out <verzeichnis>

## adb_pentest
Beschreibung: Autorisierter Sicherheitscheck (Pakete, Laufzeit, Berechtigungen).
Aufruf: "pentest" | "sicherheitscheck" | "auditiere pakete"
Parameter: --package <paketname>

## adb_logs
Beschreibung: Liest Logcat und Gerätelogs.
Aufruf: "logcat" | "gerätelogs" | "logdaten"
Parameter: --tag <tag>

## adb_shell
Beschreibung: Führt einzelne Shell-Befehle auf dem Gerät aus (nach Freigabe).
Aufruf: "führe shell-befehl aus" | "adb shell getprop"
Parameter: <befehl>

## help
Beschreibung: Zeigt alle verfügbaren Skills und Beispiele.
Aufruf: "hilfe" | "help" | "was kannst du?"
Parameter: keine
