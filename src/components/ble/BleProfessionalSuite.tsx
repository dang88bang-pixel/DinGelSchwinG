/**
 * BLE Professional Suite – natives Zusatzmodul der HackGPT-CPS NEXUS-BUILDER-Plattform.
 *
 * Vollbild-Overlay (analog zur Agent Console) mit:
 *  - Übersicht (KPIs, Agent-Workflow-Feed, Dongle-Status, RBAC)
 *  - Discovery (Scan, Klassifizierung, RSSI-Monitoring)
 *  - GATT-Explorer (Verbindungen ≤ 20, Lese/Schreib/Notify/MTU)
 *  - Mesh (Provisionierung, Pub/Sub, TTL, Modelle, Tracer)
 *  - Tests & Debug (Suiten, Makros, Performance, Sniffer, Fehlersimulation)
 *  - Simulator (bis zu 10 virtuelle Geräte, Skript-Export)
 *  - Profil-Cache (zentrale Konfigurationsprofile)
 *  - Audit-Log (vollständige Protokollierung, Export)
 *
 * Alle Aktionen laufen über `bleSuiteStore` – dieselbe Instanz, die auch die
 * Chat-Agent-Engine steuert (agentEngine.ts). Kritische Aktionen (Mesh löschen,
 * Konfiguration überschreiben, Fehlersimulation) erfordern WebAuthn.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  X, Bluetooth, Cpu, LayoutDashboard, Radar, ListTree, Network, FlaskConical,
  Boxes, Archive, ScrollText, ShieldCheck, KeyRound, Bot, ChevronRight, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { useBleStore } from './useBleStore';
import BleScanner from './BleScanner';
import GattExplorer from './GattExplorer';
import MeshBuilder from './MeshBuilder';
import TestSuitePanel from './TestSuitePanel';
import PeripheralSimulator from './PeripheralSimulator';
import ProfilesPanel from './ProfilesPanel';
import BleAuditPanel from './BleAuditPanel';
import { StatCard, Chip } from './BleCharts';
import { BleRole } from '../../lib/ble/types';

type TabKey = 'overview' | 'scanner' | 'gatt' | 'mesh' | 'tests' | 'simulator' | 'profiles' | 'audit';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Übersicht', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { key: 'scanner', label: 'Discovery', icon: <Radar className="w-3.5 h-3.5" /> },
  { key: 'gatt', label: 'GATT-Explorer', icon: <ListTree className="w-3.5 h-3.5" /> },
  { key: 'mesh', label: 'Mesh', icon: <Network className="w-3.5 h-3.5" /> },
  { key: 'tests', label: 'Tests & Debug', icon: <FlaskConical className="w-3.5 h-3.5" /> },
  { key: 'simulator', label: 'Simulator', icon: <Boxes className="w-3.5 h-3.5" /> },
  { key: 'profiles', label: 'Profil-Cache', icon: <Archive className="w-3.5 h-3.5" /> },
  { key: 'audit', label: 'Audit-Log', icon: <ScrollText className="w-3.5 h-3.5" /> },
];

const ROLES: Array<{ value: BleRole; label: string; hint: string }> = [
  { value: 'service', label: 'Service (L2)', hint: 'Scan, GATT, Tests, Profile speichern' },
  { value: 'developer', label: 'Developer (L3)', hint: '+ Mesh, Sniffer, Fehlersimulation, WebAuthn' },
  { value: 'admin', label: 'Admin', hint: 'Vollzugriff inkl. kritischer Aktionen' },
];

function AgentWorkflowFeed() {
  const store = useBleStore();
  if (!store.pendingPlan && store.agentProgress === null) {
    return (
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4 text-[10px] font-mono text-slate-500">
        <Bot className="w-3.5 h-3.5 inline mr-1.5 text-slate-500" />
        Kein aktiver Agenten-Ablauf. Formuliere im Chat z. B. „Erstelle ein Mesh-Netzwerk für die erkannten Tracker“ –
        der Agent schlägt einen geprüften Ablauf vor, den du vor der Ausführung freigibst.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-4">
      <div className="text-xs font-black text-cyan-100 mb-2 flex items-center gap-2">
        <Bot className="w-3.5 h-3.5 text-cyan-300" /> Agenten-Workflow
      </div>
      {store.pendingPlan && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-cyan-200">📋 Vorgeschlagener Ablauf: <b>{store.pendingPlan.title}</b> – wartet auf Freigabe im Chat</div>
          {store.pendingPlan.steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-slate-300">
              <ChevronRight className="w-3 h-3 text-slate-500" />
              <span className="text-slate-500">{i + 1}.</span>
              <span>{s.detail}</span>
              {s.critical && <AlertTriangle className="w-3 h-3 text-rose-300" />}
            </div>
          ))}
          <div className="pt-1 text-[9px] font-mono text-amber-200">Antworte im Agent-Chat mit „freigeben“, um die Ausführung zu starten.</div>
        </div>
      )}
      {store.agentProgress !== null && (
        <div className="mt-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-200 mb-1">
            <span>▶️ {store.agentProgressLabel}</span>
            <span>{Math.round(store.agentProgress * 100)}%</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-500" style={{ width: `${store.agentProgress * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function OverviewTab() {
  const store = useBleStore();
  const stats = store.stats();
  const connected = store.devices.filter((d) => d.connected);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="BLE-Geräte" value={String(stats.devices)} sub={`${store.scanRunning ? 'Scan aktiv' : 'Scan inaktiv'}`} accent="text-cyan-200" />
        <StatCard label="Parallele Verbindungen" value={`${stats.connected}/20`} sub="USB-C-Dongle" accent="text-emerald-200" />
        <StatCard label="Mesh-Knoten" value={String(stats.meshNodes)} sub={`${stats.meshes} Netzwerk(e)`} accent="text-amber-200" />
        <StatCard label="Test-Pass-Quote" value={`${Math.round(stats.passRate * 100)}%`} sub={`${store.simDevices.length} simulierte Geräte`} accent="text-violet-200" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <AgentWorkflowFeed />

        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-2 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" /> Sicherheit & RBAC
          </h4>
          <div className="text-[10px] font-mono text-slate-300 space-y-1">
            <div className="flex items-center gap-2"><KeyRound className="w-3 h-3 text-amber-300" /> Rolle: <b className="text-amber-200">{store.roleLabel()}</b></div>
            <div>• Scan/GATT/Tests/Profile: <b className="text-emerald-300">Service (L2)</b></div>
            <div>• Mesh / Sniffer / Fehlersimulation: <b className="text-cyan-300">Developer (L3)</b></div>
            <div>• Kritische Aktionen (Mesh löschen, Konfiguration überschreiben): <b className="text-rose-300">+ WebAuthn (FIDO2)</b></div>
            <div>• Jeder Schritt wird mit Nutzer-ID + Zeitstempel im Audit-Log protokolliert.</div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-violet-300" /> Hardware-Status
          </h4>
          <div className="flex items-center gap-3 mb-2">
            <Bluetooth className="w-6 h-6 text-violet-300" />
            <div>
              <div className="text-[11px] font-black text-white">{store.dongle.name}</div>
              <div className="text-[9px] font-mono text-slate-500">VID {store.dongle.vid} · PID {store.dongle.pid} · {store.dongle.transport}</div>
            </div>
            <Chip className="text-emerald-300 border-emerald-600/40 bg-emerald-950/40 ml-auto">erkannt & gebunden</Chip>
          </div>
          <div className="text-[9px] font-mono text-slate-600">
            Bluetooth 4.2 / 5.0 / 5.1 / 5.2 kompatibel · Agent prüft vor jeder Aktion die Dongle-Kompatibilität.
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" /> Verbundene Geräte
          </h4>
          {store.liveDevice && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-emerald-200 bg-emerald-950/30 border border-emerald-800/30 rounded-lg px-3 py-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="truncate font-bold">{store.liveDevice.name}</span>
              <Chip className="text-emerald-300 border-emerald-600/40 bg-emerald-950/40">Live · Web Bluetooth</Chip>
              <span className="ml-auto text-slate-400">
                {store.liveDevice.rssi != null ? `RSSI ${store.liveDevice.rssi} dBm` : ''} · {store.liveDevice.services.length} Services
              </span>
            </div>
          )}
          {connected.length === 0 && !store.liveDevice ? (
            <div className="text-[10px] font-mono text-slate-500">Keine aktiven Verbindungen.</div>
          ) : connected.length > 0 ? (
            <div className="space-y-1">
              {connected.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-[10px] font-mono text-slate-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="truncate font-bold text-white">{d.name}</span>
                  <span className="text-slate-500 ml-auto">RSSI {d.rssi} dBm</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function BleProfessionalSuite({
  onClose,
  initialRole = 'developer',
}: {
  onClose: () => void;
  initialRole?: BleRole;
}) {
  const store = useBleStore();
  const [tab, setTab] = useState<TabKey>('overview');

  // Initiale Rolle des angemeldeten Nutzers übernehmen (kann im Panel gewechselt werden)
  useEffect(() => {
    store.setRole(initialRole);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleHint = useMemo(
    () => ROLES.find((r) => r.value === store.role)?.hint ?? '',
    [store.role],
  );

  return (
    <div className="fixed inset-0 z-[100] bg-[#020617]/95 backdrop-blur-xl flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 bg-[#050a18]/90 flex-wrap">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-600 to-violet-700 flex items-center justify-center shadow-lg ring-1 ring-cyan-300/30">
            <Bluetooth className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white leading-none flex items-center gap-2">
              BLE Professional Suite
              <span className="text-[9px] font-bold text-cyan-300 border border-cyan-700/40 bg-cyan-950/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">NEXUS-BUILDER</span>
            </h2>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">
              KI-gestützte BLE-Entwicklungs-, Test- &amp; Betriebsumgebung · Agent Console v3.0
            </div>
          </div>
        </div>

        {/* Rollenauswahl */}
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
          <select
            value={store.role}
            onChange={(e) => store.setRole(e.target.value as BleRole)}
            title={roleHint}
            className="bg-slate-900/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-100 outline-none [&>option]:bg-slate-900"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
          <span className="hidden lg:block text-[9px] font-mono text-slate-500 max-w-[180px] truncate">{roleHint}</span>
        </div>

        <button
          onClick={onClose}
          className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition"
          aria-label="BLE Suite schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      {/* Tab-Navigation */}
      <nav className="px-4 pt-3 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-[#050a18]/60">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-xl text-[11px] font-bold border-b-2 transition whitespace-nowrap ${
              tab === t.key
                ? 'border-cyan-400 text-cyan-100 bg-white/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
            {t.key === 'scanner' && store.scanRunning && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
            {t.key === 'audit' && store.webAuthnPending && (
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
            )}
          </button>
        ))}
      </nav>

      {/* Inhalt */}
      <main className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
        <div className="max-w-[1400px] mx-auto">
          {tab === 'overview' && <OverviewTab />}
          {tab === 'scanner' && <BleScanner />}
          {tab === 'gatt' && <GattExplorer />}
          {tab === 'mesh' && <MeshBuilder />}
          {tab === 'tests' && <TestSuitePanel />}
          {tab === 'simulator' && <PeripheralSimulator />}
          {tab === 'profiles' && <ProfilesPanel />}
          {tab === 'audit' && <BleAuditPanel />}
        </div>
      </main>

      <footer className="px-5 py-2 border-t border-white/10 bg-[#050a18]/90 text-[10px] font-mono text-slate-500 flex items-center justify-between gap-3 flex-wrap">
        <span className="truncate">
          🛡️ RBAC {store.roleLabel()} · Discovery :8766 · Live-Status :8767 · Audit-Log aktiv
        </span>
        <span className="text-slate-600 hidden md:inline">
          Alle agentengesteuerten Abläufe erst nach ausdrücklicher Nutzerfreigabe
        </span>
      </footer>
    </div>
  );
}
