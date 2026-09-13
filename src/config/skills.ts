/**
 * Skill-Definitionen – Spiegel von desktop/data/skillz.md
 * Wird vom Agenten (src/lib/agent/agentEngine.ts) geladen.
 */
export interface Skill {
  name: string;
  description: string;
  calls: string[];
  params: string;
  example: string;
}

export const SKILLS: Skill[] = [
  {
    name: 'scan_network',
    description: 'Scannt ein Subnetz nach aktiven Geräten.',
    calls: ['"scanne das Netzwerk 192.168.1.0/24"', '"netzwerk-scan starten"'],
    params: '--subnet <CIDR> --timeout <sek>',
    example: 'scan_network.py --subnet 192.168.1.0/24 --timeout 2',
  },
  {
    name: 'show_devices',
    description: 'Zeigt alle gefundenen/verbundenen Geräte mit IP, Typ und Status.',
    calls: ['"zeige alle Geräte"', '"show devices"', '"welche geräte sind verbunden?"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'show_clients',
    description: 'Zeigt alle eingeloggten Clients (Name, Rolle, Gerät, letzte Aktion).',
    calls: ['"wer ist eingeloggt?"', '"zeige clients"', '"show clients"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'show_workflows',
    description: 'Zeigt laufende Workflows/Tasks mit Fortschritt und Status.',
    calls: ['"welche workflows laufen?"', '"status der angriffe"', '"show workflows"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'run_script',
    description: 'Führt ein Skript aus der Skripte-Galerie aus.',
    calls: ['"führe network_scan.py aus mit --subnet 192.168.1.0/24"'],
    params: '<dateiname> [argumente...]',
    example: 'run network_scan.py --subnet 10.0.0.0/24',
  },
  {
    name: 'assign_button',
    description: 'Belegt einen der 6 Aktionsbuttons mit einem Skript, Workflow oder Skill.',
    calls: [
      '"belege button 3 mit network_scan.py"',
      '"belege Button 1 mit workflow scan"',
      '"belege button 5 mit skill show_audit"',
    ],
    params: '<button 1-6> <skript|workflow <name>|skill=<name> [k=v …]>',
    example: 'assign_button button=5 skill=show_audit',
  },
  {
    name: 'export_log',
    description: 'Exportiert das aktuelle Audit-Log als JSON/CSV.',
    calls: ['"exportiere log"', '"ergebnis exportieren"', '"export log als csv"'],
    params: '--format json|csv',
    example: '',
  },
  {
    name: 'show_audit',
    description: 'Zeigt die letzten Audit-Einträge (wer hat was wann getan).',
    calls: ['"zeige audit-log"', '"audit"', '"wer hat was gemacht?"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'clear_cache',
    description: 'Löscht temporäre Dateien und leert den Cache.',
    calls: ['"leere cache"', '"lösche temporäre dateien"', '"clear temp"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'stop_workflow',
    description: 'Stoppt einen aktiven Workflow/Task.',
    calls: ['"stoppe workflow"', '"brich den scan ab"', '"stop"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'help',
    description: 'Zeigt alle verfügbaren Skills und Beispiele.',
    calls: ['"hilfe"', '"help"', '"was kannst du?"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'mcp_call',
    description: 'Ruft ein Tool des angeschlossenen MCP-Servers auf (mobile-dev / gateway).',
    calls: ['"mcp tool=health_check"', '"mcp call android_list_devices"', '"führe das mcp-tool android_logcat aus"'],
    params: 'tool=<name> [key=value …]',
    example: 'mcp tool=health_check verbose=true',
  },
  {
    name: 'mcp_list',
    description: 'Listet die verfügbaren MCP-Tools samt Pflichtfeldern.',
    calls: ['"mcp tools"', '"zeige die mcp-tools"', '"welche mcp-tools gibt es?"'],
    params: '[suchwort]',
    example: 'mcp tools android',
  },
  {
    name: 'mcp_connect',
    description: 'Prüft/verbindet die MCP-Bridge und das mobile BLE-Gateway.',
    calls: ['"mcp verbinden"', '"verbinde den mcp-server"', '"bridge status"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'gateway_status',
    description: 'Status des mobilen BLE-Gateways (Honeywell CT45P Xon+): Zähler, BLE, Whitelist.',
    calls: ['"gateway status"', '"wie ist der gateway-status?"', '"BLE-Gateway prüfen"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'token_auth',
    description: 'Löst den kryptografischen Handshake für ein Token aus (Whitelist → Challenge → Response).',
    calls: ['"token CT45P-0001 uid 04:a2:b3:c1 authentisieren"', '"nfc-uid 04:a2 lesen und tor nord prüfen"'],
    params: 'token_id=<id> uid=<uid> zone=<zone>',
    example: 'token_auth token_id=CT45P-0001 uid=04:A2:B3:C1:D2:E3',
  },
  {
    name: 'token_demo',
    description: 'Startet den Demo-Handshake gegen den Token-Simulator (ohne Hardware).',
    calls: ['"demo-handshake"', '"starte den test-durchlauf"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'gallery_list',
    description: 'Zeigt die Agenten-Gallerie (Marktplatz) inkl. Installationsstatus.',
    calls: ['"gallerie"', '"zeige die agenten-gallerie"', '"welche agenten gibt es?"'],
    params: '[suchwort]',
    example: 'gallerie android',
  },
  {
    name: 'gallery_install',
    description: 'Installiert und aktiviert einen Agenten aus der Gallerie.',
    calls: ['"installiere agent ble-security"', '"aktiviere den agenten sage"'],
    params: 'id=<agent-id>',
    example: 'gallery_install id=android-dev',
  },
  {
    name: 'knowledge_add',
    description: 'Fügt Text zur lokalen Wissensbasis (RAG) hinzu.',
    calls: ['"lern: CT45P Reichweite 10m"'],
    params: 'name=<titel> text=<inhalt>',
    example: 'knowledge_add name=hinweise text="Batterie unter 2,4 V melden"',
  },
  {
    name: 'knowledge_search',
    description: 'Sucht in der Wissensbasis und liefert Zitate mit Abschnittsangabe.',
    calls: ['"suche im wissen: batteriewarnung"', '"was steht in der doku über die antenne?"'],
    params: '<frage oder stichwörter> [top=n]',
    example: 'knowledge_search ct45p reichweite',
  },
  {
    name: 'gateway_sessions',
    description: 'Letzte Lesevorgänge am Gateway inkl. Grant/Deny-Grund und Latenz.',
    calls: ['"gateway sessions"', '"wer wurde abgelehnt?"', '"letzte lesungen"'],
    params: '[limit=n]',
    example: '',
  },
  {
    name: 'gateway_tokens',
    description: 'Token-Whitelist des mobilen Gateways: Zonen, Rollen, Sperr- und Tamper-Status je Honeywell-CT45P-Token.',
    calls: ['"gateway whitelist"', '"welche token sind freigeschaltet?"', '"sind token gesperrt?"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'gateway_selftest',
    description: 'Kurzer In-Prozess-Selbsttest des Gateways (Frame-Codec); vollständig per CLI.',
    calls: ['"gateway selbsttest"', '"prüfe das gateway durch"'],
    params: 'keine',
    example: 'python3 mobile-server/mobile_ble_server.py selftest',
  },
  {
    name: 'gateway_grant',
    description: 'Meldet ein vom Agenten geprüftes Ergebnis zurück (delegated-Modus: GRANT/DENY pro sid).',
    calls: ['"freigabe für sid S6AA0B32C-0003 erteilen"', '"deny für sid …"'],
    params: 'sid=<sid> granted=true|false',
    example: 'gateway_grant sid=S6AA0B32C-0003 granted=true',
  },
  {
    name: 'page_ingest',
    description:
      'Seiten-Ingest: URL (oder gezogene Datei) aus dem Chatfenster – Inhalt ziehen, prüfen und intern ablegen: Seite als Asset, verlinkte Software, Info-Satz und Bibliothekseintrag (RAG, maskiert). Ohne Gateway läuft dieselbe Kette rein lokal: Datei ziehen → Asset-Store (IndexedDB) + Bibliothek, Quelle „lokal“.',
    calls: [
      '"importiere https://media.internal/handbuch in die bibliothek"',
      '"nimm die seite in die wissensbasis"',
      '"URL ins Chatfenster ziehen"',
      '"Datei ins Chatfenster ziehen (ohne Gateway)"',
    ],
    params: '<url> [ohne software] – Links folgen an, außer „nur seite“ · Datei-Drop braucht keine Parameter',
    example: 'src/lib/pageIngest.ts → ingestPage({ url }) / ingestPage({ file })  ·  Offline: grabFromFile()  ·  Desktop: utils/page_ingest.py → ingest_file()',
  },
  {
    name: 'content_review',
    description:
      'Inhalts-Gutachten vor dem Ablegen: lesbarer Text, Gliederung, Skript-Anteil, Secret-Muster, Duplikat, verlinkte Software – blockierte Quellen werden gemeldet statt gespeichert. Funktioniert für URLs und für gezogene Dateien (offline, ohne Gateway).',
    calls: ['"prüf den inhalt von https://…"', '"check die seite https://…"', '"prüf die gezogene Datei"'],
    params: '<url> – schreibt nichts in die Bibliothek',
    example: 'src/lib/pageIngest.ts → reviewContent(extractReadable(html), …)',
  },
  {
    name: 'portview_scan',
    description:
      'PortView: Mobile-Server im Netz automatisch finden (UDP-Broadcast :18791 + HTTP-Probe) und Gateway-/Bridge-Port in der App setzen.',
    calls: ['"portview"', '"finde den server-port"', '"wo läuft der mobile server"', '"portview erzwingen"'],
    params: '[erzwingen] – manuelle Einstellungen werden sonst nicht überschrieben',
    example: 'src/lib/portview.ts → autoConfigure({ force })  ·  native: PortViewPlugin.discover()',
  },
  {
    name: 'grabber_import_url',
    description:
      'Software-Grabber: URL (Datei oder Pack-Manifest) in den Asset-Katalog importieren – Beats, Samples, UI-Styles, Effekte, Filter; dedupliziert per SHA-256, offline nutzbar.',
    calls: ['"importiere https://files.internal/packs/dgs-demo-pack.json"', '"grabbe … als beats"', '"importiere … als styles"'],
    params: '<url> [als <kategorie>] – Kategorie sonst MIME-/namensbasiert erkannt',
    example: 'POST /gateway/import {"url":"…","category":"beats","tags":["werk"]}  ·  src/lib/grabber.ts → grabFromUrl()',
  },
  {
    name: 'node_status',
    description:
      'Enterprise-Knoten: Bestand (MCP, API, Web-Hook, Notebook, KI-Inferenz) samt echter Endpunkt-Probe — erreichbar, Fehlerstatus, Timeout oder nicht probbares Schema.',
    calls: ['"zeige die enterprise-knoten"', '"knoten status"', '"ist der api-knoten erreichbar?"'],
    params: '[node=<kategorie>] – ohne Angabe werden alle fünf Knoten geprobt',
    example: 'src/config/enterprise-nodes.ts → probeAllNodes()  ·  Backend: GET /api/nodes/validate?node=all',
  },
  {
    name: 'show_metrics',
    description: 'Live-Kennzahlen des Agenten: Läufe, Zeit, Tokens, Kosten, Cache-Trefferquote.',
    calls: ['"dashboard"', '"zeige die metriken"', '"was haben die letzten läufe gekostet?"'],
    params: 'keine',
    example: '',
  },
];

export function skillsToPrompt(skills: Skill[] = SKILLS): string {
  return skills.map(
    (s) => `- ${s.name}: ${s.description}\n    Aufruf: ${s.calls.join(' | ')}\n    Parameter: ${s.params}${s.example ? `\n    Beispiel: ${s.example}` : ''}`,
  ).join('\n');
}
