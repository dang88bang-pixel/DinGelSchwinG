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
Aufruf: "welche workflows laufen?" | "status der angriffe" | "show workflows"
Parameter: keine

## run_script
Beschreibung: Führt ein Skript aus der Skripte-Galerie lokal oder remote aus.
Aufruf: "führe network_scan.py aus mit --subnet 192.168.1.0/24"
Parameter: <dateiname> [argumente...]
Beispiel: run network_scan.py --subnet 10.0.0.0/24

## assign_button
Beschreibung: Belegt einen der 6 Aktionsbuttons mit einem Skript, Workflow oder Skill.
Aufruf: "belege button 3 mit network_scan.py" | "belege Button 1 mit workflow scan" | "belege button 5 mit skill show_audit"
Parameter: <button 1-6> <skript|workflow <name>|skill=<name> [k=v …]>
Beispiel: assign_button button=5 skill=show_audit

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

## mcp_call
Beschreibung: Ruft ein Tool des angeschlossenen MCP-Servers auf (mobile-dev / gateway).
Aufruf: "mcp tool=health_check" | "mcp call android_list_devices" | "führe das mcp-tool android_logcat aus"
Parameter: tool=<name> [key=value …]
Beispiel: mcp tool=health_check verbose=true

## mcp_list
Beschreibung: Listet die verfügbaren MCP-Tools samt Pflichtfeldern.
Aufruf: "mcp tools" | "zeige die mcp-tools" | "welche mcp-tools gibt es?"
Parameter: [suchwort]

## mcp_connect
Beschreibung: Prüft/verbindet die MCP-Bridge und das mobile BLE-Gateway.
Aufruf: "mcp verbinden" | "verbinde den mcp-server" | "bridge status"
Parameter: keine

## gateway_status
Beschreibung: Status des mobilen BLE-Gateways (Honeywell CT45P Xon+): Zähler, BLE, Whitelist.
Aufruf: "gateway status" | "wie ist der gateway-status?" | "BLE-Gateway prüfen"
Parameter: keine

## gateway_sessions
Beschreibung: Letzte Lesevorgänge mit Begründung, Dauer und Batterie.
Aufruf: "gateway sessions" | "wer wurde abgelehnt" | "protokoll der lesungen"
Parameter: keine

## token_auth
Beschreibung: Stößt den kryptografischen Handshake für ein Token an (Whitelist → Challenge → Response).
Aufruf: "token CT45P-0001 uid 04:a2:b3:c1 authentisieren" | "nfc-uid 04:a2 lesen"
Parameter: token_id=<id> uid=<uid> [session_material=<hex>]
Beispiel: token_auth token_id=CT45P-0001 uid=04:A2:B3:C1:D2:E3

## token_demo
Beschreibung: Startet den Demo-Handshake gegen den Token-Simulator (ohne Hardware).
Aufruf: "demo-handshake" | "starte den test-durchlauf"
Parameter: keine

## gallery_list
Beschreibung: Zeigt die Agenten-Gallerie (Marktplatz) inkl. Installationsstatus.
Aufruf: "gallerie" | "zeige die agenten-gallerie" | "welche agenten gibt es?"
Parameter: [suchwort]

## gallery_install
Beschreibung: Installiert und aktiviert einen Agenten aus der Gallerie.
Aufruf: "installiere agent ble-security" | "aktiviere den agenten sage"
Parameter: id=<agent-id>

## knowledge_search
Beschreibung: Sucht in der lokalen Wissensbasis (data/knowledge/) und liefert Zitate.
Aufruf: "suche im wissen: batteriewarnung" | "was steht in der doku über die antenne?"
Parameter: <frage oder stichwörter> [top=n]

## knowledge_add
Beschreibung: Übernimmt Text in die Wissensbasis (Datei data/knowledge/<name>.md).
Aufruf: "lern: CT45P Reichweite 10 m" | "indexiere in die Wissensbasis: …"
Parameter: name=<titel> text=<inhalt>

## node_status
Beschreibung: Enterprise-Knoten: Bestand (MCP, API, Web-Hook, Notebook, KI-Inferenz) samt echter Endpunkt-Probe – erreichbar, Fehlerstatus, Timeout oder nicht probbares Schema.
Aufruf: "zeige die enterprise-knoten" | "knoten status" | "ist der api-knoten erreichbar?"
Parameter: node=<kategorie> – ohne Angabe werden alle fünf Knoten geprobt
Quelle: config/enterprise-nodes.csv (server/nodes.py) · Backend: GET /api/nodes/validate?node=all

## show_metrics
Beschreibung: Live-Kennzahlen des Agenten: Läufe, Zeit, Tokens, Kosten, Cache-Trefferquote.
Aufruf: "dashboard" | "zeige die metriken" | "was haben die letzten läufe gekostet?"
Parameter: keine

## gateway_tokens
Beschreibung: Zeigt die Token-Whitelist des Gateways (Zonen, Rollen, Sperr-/Tamper-Status).
Aufruf: "gateway whitelist" | "welche token sind freigeschaltet?" | "sind token gesperrt?"
Parameter: keine

## gateway_grant
Beschreibung: Meldet ein im Agenten geprüftes Ergebnis ans Gateway zurück (delegated-Modus).
Aufruf: "freigabe für sid S6AA0B32C-0003 erteilen" | "deny für sid …"
Parameter: sid=<sid> granted=true|false

## gateway_selftest
Beschreibung: Kurzer In-Prozess-Selbsttest des Gateways (Frame-Codec). Vollständig: CLI-Selbsttest mit 16 Prüfungen.
Aufruf: "gateway selbsttest" | "prüfe das gateway durch"
Parameter: keine

## portview_scan
Beschreibung: Findet Mobile-Server (Host + Port) automatisch: UDP-Broadcast auf :18791 gegen den Discovery-Responder, danach HTTP-/status-Probe. Die Desktop-Konsole nutzt denselben Mechanismus als Fallback, wenn DGS_GATEWAY_URL nicht gesetzt ist und :8791 nicht antwortet (utils/clients.py).
Aufruf: "portview" | "finde den server-port" | "wo läuft der mobile server" | "portview erzwingen"
Parameter: [erzwingen]  ·  ENV: DGS_PORTVIEW=0 (aus), DGS_GATEWAY_URL (setzt die Suche außer Kraft), DGS_DISCOVER_PORT (Standard 18791)
Beispiel: python3 mobile-server/discovery.py --hosts 127.0.0.1,192.168.4.21

## grabber_import_url
Beschreibung: Importiert eine URL (Datei oder Pack-Manifest) in den Asset-Katalog des Mobile-Servers – Beats, Samples, UI-Styles, Effekte, Filter. Grenzen: 64 MiB, 20 s, 5 Redirects (je Hop neu geprüft), SSRF-Filter gegen Metadaten-/Multicast-Adressen; Dedupe über SHA-256.
Aufruf: "importiere http://files.internal/packs/dgs-demo-pack.json" | "grabbe … als beats" | "importiere … als styles"
Parameter: <url> [als <kategorie>]  ·  ENV: DGS_IMPORT_MAX_MB, DGS_IMPORT_TIMEOUT_S, DGS_IMPORT_ALLOW_PRIVATE
Beispiel: curl -X POST http://127.0.0.1:8791/import -d '{"url":"http://127.0.0.1:5173/demo/packs/dgs-demo-pack.json","tags":["werk"]}'

## page_ingest
Beschreibung: Seiten-Ingest – der Agent zieht eine Seite (URL aus dem Chat-Fenster-Drop oder Befehl), prüft den Inhalt und legt intern ab: Seite als Asset im Katalog, verlinkte Beats/Samples/UI-Styles/Effekte/Filter, Kurzinfo im Chat und ein Dokument in data/knowledge/ (Skripte entfernt, Secret-Muster maskiert).
Aufruf: "importiere http://media.internal/handbuch in die bibliothek" | "nimm die seite in die wissensbasis" | "URL ins Chatfenster ziehen"
Parameter: <url>  ·  „ohne software“/„nur seite“ überspringt die Link-Importe
Beispiel: python3 -c "import sys;sys.path.insert(0,'desktop');from utils import page_ingest as P;print(P.format_ingest_report(P.ingest_url('http://127.0.0.1:8123/demo/seite/index.html')))"

## content_review
Beschreibung: Gutachten über den Inhalt einer URL, ohne etwas abzulegen – Prüfpunkte: Quelle, Größe, lesbarer Text, Gliederung, Skript-/Style-Anteil, Schutzbedarf (Secret-Muster), verlinkte Software, Duplikat.
Aufruf: "prüf den inhalt von http://media.internal/rampe-12" | "check die seite https://…"
Parameter: <url>
Beispiel: utils/page_ingest.py → review_content(extract_readable(html), meta, links)  (Ergebnis: ok | attention | blockiert)
