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

/** BLE-Skills der BLE Professional Suite (Modus C) – auch im Chat-Modus verfügbar. */
export const BLE_SKILLS: Skill[] = [
  {
    name: 'ble_scan',
    description: 'Startet/stoppt den kontinuierlichen BLE-Scan und zeigt die erkannten Geräte mit Klassifizierung.',
    calls: ['"scanne ble"', '"ble-geräte suchen"', '"starte ble-scan"', '"stoppe den ble-scan"'],
    params: 'keine (kontinuierlich, RSSI + Klassifizierung)',
    example: 'Scanne BLE nach Geräten in Reichweite',
  },
  {
    name: 'ble_devices',
    description: 'Zeigt alle erkannten BLE-Geräte (Klasse, RSSI, Hersteller, UUIDs, Provisionierungsstatus).',
    calls: ['"zeige ble-geräte"', '"welche ble geräte sind da?"', '"ble devices"'],
    params: '--class ntag|token|mesh|peripheral --min-rssi <dBm>',
    example: '',
  },
  {
    name: 'ble_connect',
    description: 'Verbindet ein Gerät (max. 20 parallele Verbindungen über den USB-C-Dongle).',
    calls: ['"verbinde dich mit NTag-Tracker-Büro3-01"', '"connecte TempSensor-Eingang"'],
    params: '<gerätename>',
    example: '',
  },
  {
    name: 'gatt_explore',
    description: 'Zeigt alle GATT-Services, Characteristics und Descriptoren eines Geräts.',
    calls: ['"zeige gatt dienste von X"', '"gatt explorer"', '"welche services hat X?"'],
    params: '<gerätename>',
    example: '',
  },
  {
    name: 'gatt_read',
    description: 'Liest einen GATT-Wert und zeigt ihn in Hex, Dezimal, Binär und ASCII.',
    calls: ['"lies batterie level"', '"gatt read X"'],
    params: '<gerät> <characteristic>',
    example: '',
  },
  {
    name: 'gatt_write',
    description: 'Schreibt einen Wert (hex) in eine GATT-Characteristic nach Freigabe.',
    calls: ['"schreibe 0xBEEF in batterie-monitoring"', '"gatt write X"'],
    params: '<gerät> <characteristic> <hex-wert>',
    example: '',
  },
  {
    name: 'ble_mesh_create',
    description: 'Erstellt ein Mesh-Netzwerk inkl. Schlüsselverwaltung (Plan → Freigabe → Provisionierung).',
    calls: ['"erstelle ein mesh-netzwerk"', '"mesh für die tracker im büro 3"'],
    params: '<name>',
    example: 'Erstelle ein Mesh-Netzwerk für die 4 erkannten Smart-Tracker im Büro 3',
  },
  {
    name: 'ble_mesh_status',
    description: 'Zeigt Mesh-Netzwerke, Knoten, Rollen, Pub/Sub-Adressen, TTL und Live-Status.',
    calls: ['"mesh status"', '"welche mesh netzwerke gibt es?"'],
    params: 'keine',
    example: '',
  },
  {
    name: 'ble_configure',
    description: 'Erstellt einen Konfigurationsablauf für ein Gerät (z. B. NTag Batterieüberwachung) und führt ihn nach Freigabe aus.',
    calls: ['"konfiguriere den NTag-Tracker mit Seriennummer XY"', '"batterieüberwachung aktivieren"'],
    params: '<gerätename> [profil]',
    example: 'Konfiguriere den NTag-Tracker mit der Seriennummer XY für die Batterieüberwachung',
  },
  {
    name: 'ble_test_suite',
    description: 'Startet vordefinierte Test-Suiten (NTag, BLE-Token, Mesh, Performance) und wertet Ergebnisse aus.',
    calls: ['"führe die ntag test-suite aus"', '"regressionstest starten"', '"test suite token"'],
    params: '--suite ntag|token|mesh|performance',
    example: '',
  },
  {
    name: 'ble_simulate',
    description: 'Erstellt simulierte BLE-Geräte (max. 10) für Tests ohne physische Hardware.',
    calls: ['"simuliere ein gerät"', '"erstelle 3 simulierte token"'],
    params: '--count <n> --class ntag|token|mesh|peripheral',
    example: '',
  },
  {
    name: 'ble_profile',
    description: 'Speichert oder wendet Konfigurationsprofile aus dem zentralen Profil-Cache an.',
    calls: ['"speichere profil"', '"wende profil X auf Y an"', '"profile anzeigen"'],
    params: '--save <name> | --apply <profil> <gerät>',
    example: '',
  },
  {
    name: 'ble_audit',
    description: 'Zeigt das BLE-Audit-Log (alle Scans, Verbindungen, Lese-/Schreibvorgänge, Agenten-Schritte).',
    calls: ['"zeige ble audit"', '"ble audit log"'],
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
];

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
    description: 'Belegt einen der 6 Aktionsbuttons mit einem Skript, Workflow oder Task.',
    calls: ['"belege button 3 mit network_scan.py"', '"belege Button 1 mit workflow scan"'],
    params: '<button 1-6> <skript|workflow|task>',
    example: 'Belege Button 2 mit dem Skript backup_config.sh',
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
  ...BLE_SKILLS,
];

export function skillsToPrompt(skills: Skill[] = SKILLS): string {
  return skills.map(
    (s) => `- ${s.name}: ${s.description}\n    Aufruf: ${s.calls.join(' | ')}\n    Parameter: ${s.params}${s.example ? `\n    Beispiel: ${s.example}` : ''}`,
  ).join('\n');
}
