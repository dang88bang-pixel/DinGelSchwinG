# DinGelSchwinG Agent Console v3.0 – Skill-Definitionen
# Wird beim Start vom Agenten geladen (utils/skill_loader.py).

## scan_network
Beschreibung: Scannt ein Subnetz nach aktiven Geräten.
Aufruf: "scanne das Netzwerk 192.168.1.0/24" | "netzwerk-scan starten"
Parameter: --subnet <CIDR> --timeout <sek>
Beispiel: scan_network.py --subnet 192.168.1.0/24 --timeout 2

## show_devices
Beschreibung: Zeigt alle gefundenen/verbundenen Geräte mit IP, Typ und Status.
Aufruf: "zeige alle Geräte" | "show devices" | "welche geräte sind verbunden?"
Parameter: keine

## show_clients
Beschreibung: Zeigt alle eingeloggten Clients (Name, Rolle, Gerät, letzte Aktion).
Aufruf: "wer ist eingeloggt?" | "zeige clients" | "show clients"
Parameter: keine

## show_workflows
Beschreibung: Zeigt laufende Workflows/Tasks mit Fortschritt und Status.
Aufruf: "welche workflows laufen?" | "status der aufgaben" | "show workflows"
Parameter: keine

## run_script
Beschreibung: Führt ein Skript aus der Skripte-Galerie lokal oder remote aus.
Aufruf: "führe network_scan.py aus mit --subnet 192.168.1.0/24"
Parameter: <dateiname> [argumente...]
Beispiel: run network_scan.py --subnet 10.0.0.0/24

## assign_button
Beschreibung: Belegt einen der 6 Aktionsbuttons mit einem Skript, Workflow oder Task.
Aufruf: "belege button 3 mit network_scan.py" | "belege Button 1 mit workflow scan"
Parameter: <button 1-6> <skript|workflow|task>
Beispiel: Belege Button 2 mit dem Skript backup_config.sh

## export_log
Beschreibung: Exportiert das aktuelle Audit-Log als JSON/CSV.
Aufruf: "exportiere log" | "ergebnis exportieren" | "export log als csv"
Parameter: --format json|csv

## show_audit
Beschreibung: Zeigt die letzten Audit-Einträge (wer hat was wann getan).
Aufruf: "zeige audit-log" | "audit" | "wer hat was gemacht?"
Parameter: keine

## clear_cache
Beschreibung: Löscht temporäre Dateien und leert den Cache.
Aufruf: "leere cache" | "lösche temporäre dateien" | "clear temp"
Parameter: keine

## stop_workflow
Beschreibung: Stoppt einen aktiven Workflow/Task.
Aufruf: "stoppe workflow" | "brich den scan ab" | "stop"
Parameter: keine

## help
Beschreibung: Zeigt alle verfügbaren Skills und Beispiele.
Aufruf: "hilfe" | "help" | "was kannst du?"
Parameter: keine
