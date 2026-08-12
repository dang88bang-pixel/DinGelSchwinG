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
];

export function skillsToPrompt(skills: Skill[] = SKILLS): string {
  return skills.map(
    (s) => `- ${s.name}: ${s.description}\n    Aufruf: ${s.calls.join(' | ')}\n    Parameter: ${s.params}${s.example ? `\n    Beispiel: ${s.example}` : ''}`,
  ).join('\n');
}
