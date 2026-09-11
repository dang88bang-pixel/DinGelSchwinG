// REAL-IMPLEMENTATION 2026-09-11
// Network state is read from the configured gateway or from an explicit physical
// pairing event. The 3D layout uses deterministic display coordinates only.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Radio, Wifi, Bluetooth, ShieldCheck, Cpu, Waves, Activity, Menu, Layers, CircleDot, RefreshCw, AlertCircle } from 'lucide-react';
import Scene3D from './Scene3D';
import PairingPanel, { PairedDevice } from './PairingPanel';
import NetworkDiagnostics from './diagnostics/NetworkDiagnostics';
import MeshControl from './MeshControl';
import ReplayEditor from './ReplayEditor';
import RosettaPanel from './RosettaPanel';
import NetworkSettings from './NetworkSettings';
import AgentConsole from './AgentConsole';
import AgentGalleryPanel from './AgentGalleryPanel';
import KnowledgeBasePanel from './KnowledgeBasePanel';
import LiveDashboardPanel from './LiveDashboardPanel';
import McpServerPanel from './McpServerPanel';
import PortViewPanel from './PortViewPanel';
import DevicePortViewPanel from './DevicePortViewPanel';
import FlashCenterPanel from './FlashCenterPanel';
import AssetGrabberPanel from './AssetGrabberPanel';
import LiveStatusStrip from './LiveStatusStrip';
import { useSensors } from '../hooks/useSensors';
import { useTranslation } from 'react-i18next';
import { loadBLEWasm, BLEWasmExports } from '../lib/bleWasm';
import { gatewayCommand } from '../lib/mcpClient';

export interface SceneDevice {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  type: 'master' | 'client' | 'target' | 'other';
  rssi?: number;
  distance?: number;
  txPower?: number;
  source: 'gateway' | 'pairing';
  observedAt: string;
}

type GatewayDevice = Record<string, unknown>;
type PanelId = 'gallery' | 'dashboard' | 'knowledge' | 'mcp' | 'portview' | 'devices' | 'flash' | 'grabber' | null;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function positionFor(id: string): Pick<SceneDevice, 'x' | 'y' | 'z'> {
  // This is a stable visual projection, not a measured location.
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const unit = (shift: number) => (((hash >>> shift) & 0xff) / 255) * 6 - 3;
  return { x: unit(0), y: unit(8) * 0.45, z: unit(16) };
}

function deviceFromGateway(raw: GatewayDevice): SceneDevice | null {
  const id = asString(raw.id ?? raw.address ?? raw.device_id ?? raw.token_id);
  if (!id) return null;
  const type = asString(raw.type)?.toLowerCase();
  const deviceType: SceneDevice['type'] = type === 'master' || type === 'client' || type === 'target' ? type : 'other';
  return {
    id,
    name: asString(raw.name ?? raw.label) ?? id,
    ...positionFor(id),
    type: deviceType,
    rssi: asNumber(raw.rssi),
    txPower: asNumber(raw.tx_power ?? raw.txPower),
    source: 'gateway',
    observedAt: new Date().toISOString(),
  };
}

function deviceFromPairing(device: PairedDevice): SceneDevice {
  return {
    id: device.id,
    name: device.name,
    ...positionFor(device.id),
    type: 'client',
    rssi: device.rssi,
    txPower: device.txPower,
    source: 'pairing',
    observedAt: device.boundAt,
  };
}

function mergeDevices(previous: SceneDevice[], incoming: SceneDevice[]): SceneDevice[] {
  const merged = new Map(previous.map((device) => [device.id, device]));
  incoming.forEach((device) => merged.set(device.id, { ...merged.get(device.id), ...device }));
  return [...merged.values()];
}

export default function NetworkDashboard() {
  const { t } = useTranslation();
  const sensors = useSensors();
  const [mode, setMode] = useState<'ble' | 'wifi' | 'usb'>('ble');
  const [wasmModule, setWasmModule] = useState<BLEWasmExports | null>(null);
  const [wasmState, setWasmState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [distanceRuntime, setDistanceRuntime] = useState<'wasm' | 'javascript' | null>(null);
  const [devices, setDevices] = useState<SceneDevice[]>([]);
  const [boundClients, setBoundClients] = useState<PairedDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [panel, setPanel] = useState<PanelId>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [networkStatus, setNetworkStatus] = useState('Noch kein physischer Gateway-Scan ausgeführt.');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadBLEWasm()
      .then((module) => {
        if (!mountedRef.current) return;
        setWasmModule(module);
        setDistanceRuntime(module.runtime);
        setWasmState('ready');
      })
      .catch(() => {
        if (mountedRef.current) setWasmState('unavailable');
      });
    return () => { mountedRef.current = false; };
  }, []);

  const scanGateway = useCallback(async () => {
    if (scanBusy) return;
    setScanBusy(true);
    setNetworkStatus('Gateway-BLE-Scan läuft…');
    try {
      const response = await gatewayCommand('ble_scan', { timeout: 8 });
      if (response.ok !== true) throw new Error(String(response.reason ?? response.error ?? 'Gateway hat den Scan abgelehnt.'));
      if (response.backend === 'mock') {
        setNetworkStatus('Gateway meldet Mock-Backend. Simulierte Ergebnisse wurden verworfen.');
        return;
      }
      const scanned = Array.isArray(response.devices)
        ? response.devices.filter((entry): entry is GatewayDevice => Boolean(entry) && typeof entry === 'object').map(deviceFromGateway).filter((entry): entry is SceneDevice => entry !== null)
        : [];
      setDevices((previous) => mergeDevices(previous, scanned));
      setNetworkStatus(scanned.length
        ? `${scanned.length} physisch vom Gateway beobachtete Geräte · ${new Date().toLocaleTimeString()}`
        : 'Gateway-Scan beendet: keine Geräte gefunden.');
    } catch (error) {
      setNetworkStatus(`Gateway-Scan fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      setScanBusy(false);
    }
  }, [scanBusy]);

  const handleBind = useCallback((device: PairedDevice) => {
    setBoundClients((previous) => previous.some((item) => item.id === device.id)
      ? previous.map((item) => item.id === device.id ? device : item)
      : [...previous, device]);
    setDevices((previous) => mergeDevices(previous, [deviceFromPairing(device)]));
    setSelectedId(device.id);
  }, []);

  const devicesWithDistance = useMemo(() => devices.map((device) => {
    if (!wasmModule || device.rssi === undefined || device.txPower === undefined) return device;
    try {
      return { ...device, distance: wasmModule.calculate_distance(device.rssi, device.txPower) };
    } catch {
      return device;
    }
  }), [devices, wasmModule]);

  const sceneDevices = useMemo(() => devicesWithDistance.map(({ id, name, x, y, z, type, rssi }) => ({ id, name, x, y, z, type, rssi })), [devicesWithDistance]);
  const selectedDevice = devicesWithDistance.find((device) => device.id === selectedId);

  const panelActions: readonly [Exclude<PanelId, null>, string, string, string][] = [
    ['gallery', '🖼️', t('app.gallery'), t('panels.gallery.subtitle')],
    ['dashboard', '📊', t('app.dashboard'), t('panels.dashboard.subtitle')],
    ['knowledge', '📚', t('app.knowledge'), t('panels.knowledge.subtitle')],
    ['mcp', '🔌', t('app.mcp'), t('panels.mcp.subtitle')],
    ['portview', '🧭', t('app.portview', 'PortView'), t('panels.portview.subtitle', 'Server-Port automatisch finden')],
    ['devices', '📱', t('app.devices', 'Geräte'), t('panels.deviceportview.subtitle', 'USB + ADB')],
    ['flash', '🚀', t('app.flash', 'Flash'), t('panels.flashcenter.subtitle', 'Custom-OS')],
    ['grabber', '📥', t('app.grabber', 'Grabber'), t('panels.grabber.subtitle', 'URLs importieren')],
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#020617] via-[#050a18] to-[#0b1220] text-slate-100 font-sans selection:bg-cyan-400/30 overflow-hidden">
      <LiveStatusStrip />
      <header className="sticky top-0 z-50 bg-[#050a18]/80 backdrop-blur-2xl border-b border-white/10 px-5 md:px-8 py-4 flex items-center justify-between shadow-2xl shadow-blue-950/30">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setMenuOpen((open) => !open)} className="md:hidden p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-200 border border-white/10 transition"><Menu className="w-5 h-5" /></button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-cyan-200 to-violet-200 leading-none glow-text">DinGelSchwinG <span className="text-sm font-medium text-slate-400 align-top ml-1">NEXUS-BUILDER</span></h1>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] font-mono text-slate-400"><span><CircleDot className="inline w-3 h-3 text-emerald-400" /> physisch beobachtet</span><span className="text-slate-600">| BLE · 3D · Sensoren</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <button type="button" onClick={() => setAgentOpen(true)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white ring-1 ring-violet-300/40 shadow-xl hover:brightness-110 transition">🤖 Agent</button>
          {panelActions.map(([id, icon, label, title]) => <button type="button" key={id} onClick={() => setPanel(panel === id ? null : id)} title={title} className={`hidden md:flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-extrabold transition ring-1 ${panel === id ? 'bg-white text-slate-900 ring-white/60' : 'bg-white/5 text-slate-300 hover:bg-white/10 ring-white/10'}`}>{icon} {label}</button>)}
          {(['ble', 'wifi', 'usb'] as const).map((item) => <button type="button" key={item} onClick={() => setMode(item)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold transition ring-1 ring-white/10 ${mode === item ? 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white ring-cyan-300/50' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{item === 'ble' ? <Bluetooth className="w-3.5 h-3.5" /> : item === 'wifi' ? <Wifi className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}{item.toUpperCase()}</button>)}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-8 py-6 md:py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <section className="flex flex-col gap-6">
          <div className="rounded-3xl overflow-hidden shadow-2xl shadow-blue-950/40 ring-1 ring-white/10 bg-gradient-to-b from-[#060f2a] to-[#020617]">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-gradient-to-r from-[#060f2a]/90 to-[#0a1835]/70 border-b border-white/10 backdrop-blur-md">
              <div className="text-xs font-mono text-cyan-200"><Layers className="inline w-3.5 h-3.5 text-amber-300" /> 3D-Ansicht — Anzeige-Koordinaten, keine Ortungsmessung <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${wasmState === 'ready' ? 'bg-emerald-900/60 text-emerald-200 border-emerald-600/40' : wasmState === 'unavailable' ? 'bg-rose-900/50 text-rose-200 border-rose-600/40' : 'bg-amber-900/40 text-amber-200 border-amber-600/30'}`}>{wasmState === 'ready' ? distanceRuntime === 'wasm' ? 'WASM aktiv' : 'JS-Referenz aktiv' : wasmState === 'unavailable' ? 'Distanzmodul nicht verfügbar' : 'Distanzmodul lädt…'}</span></div>
              <button type="button" disabled={scanBusy} onClick={() => void scanGateway()} className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1.5 rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:bg-slate-700 text-white"><RefreshCw className={`w-3.5 h-3.5 ${scanBusy ? 'animate-spin' : ''}`} /> {scanBusy ? 'Scan…' : 'Gateway scannen'}</button>
            </div>
            <div className="px-5 py-2 text-[11px] font-mono border-b border-white/5 text-slate-400">{networkStatus}</div>
            <div className="h-[420px] md:h-[540px] relative"><Scene3D devices={sceneDevices} onSelect={setSelectedId} /></div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {devicesWithDistance.length === 0 ? <div className="col-span-full rounded-2xl p-5 glass-card text-sm text-slate-400"><AlertCircle className="inline w-4 h-4 text-amber-300 mr-2" />Keine Netzgeräte angezeigt. Einen physischen Gateway-Scan starten oder einen Client koppeln.</div> : devicesWithDistance.map((device) => <button type="button" key={device.id} onClick={() => setSelectedId(device.id)} className={`text-left rounded-2xl p-4 glass-card border transition hover:-translate-y-0.5 relative overflow-hidden ${selectedId === device.id ? 'ring-2 ring-amber-300/60' : 'border-white/10'}`}>
              <div className="flex justify-between mb-2"><span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-300">{device.type}</span><span className="text-[10px] text-slate-500">{device.source}</span></div>
              <div className="text-base font-black text-white leading-tight mb-1.5 truncate">{device.name}</div>
              <div className="text-[11px] font-mono text-slate-400">RSSI <b className="text-cyan-200">{device.rssi !== undefined ? `${device.rssi} dBm` : 'nicht verfügbar'}</b></div>
              <div className="text-[11px] font-mono text-slate-400 mt-1">Distanz <b className="text-amber-200">{device.distance !== undefined ? `${device.distance.toFixed(2)} m` : 'nicht berechenbar'}</b></div>
            </button>)}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-3xl p-5 bg-gradient-to-br from-blue-950/40 to-indigo-950/40 border border-blue-800/30 backdrop-blur-xl">
              <h3 className="text-sm font-black text-blue-100 flex items-center gap-2 mb-4"><Cpu className="w-4 h-4 text-blue-300" /> Geräte-Sensoren</h3>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">{[{ label: 'Alpha', value: sensors.alpha, color: 'text-cyan-300' }, { label: 'Beta', value: sensors.beta, color: 'text-amber-300' }, { label: 'Gamma', value: sensors.gamma, color: 'text-violet-300' }].map((sensor) => <div key={sensor.label} className="bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5"><div className="text-[10px] text-slate-400">{sensor.label}</div><div className={`font-bold text-sm ${sensor.color}`}>{sensor.value !== null ? `${sensor.value.toFixed(1)}°` : '--'}</div></div>)}</div>
              <div className="mt-4 flex gap-2"><button type="button" onClick={() => void sensors.requestPermission()} className="text-[11px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-extrabold">Sensor-Berechtigung</button><span className={`text-[11px] px-2.5 py-1.5 rounded-lg font-mono font-extrabold ${sensors.permissionGranted ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>{sensors.permissionGranted ? 'Gewährt' : 'Nicht gewährt'}</span></div>
            </div>
            <div className="rounded-3xl p-5 bg-gradient-to-br from-amber-950/30 to-orange-950/30 border border-amber-800/30 backdrop-blur-xl">
              <h3 className="text-sm font-black text-amber-100 flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-amber-300" /> Abstandsbestimmung</h3>
              <div className="text-xs font-mono text-slate-300 space-y-2"><div className="flex justify-between border-b border-amber-800/30 pb-1"><span>Runtime</span><b className="text-amber-200">{wasmState === 'ready' ? distanceRuntime === 'wasm' ? 'WASM geladen' : 'JavaScript-Referenz' : wasmState === 'unavailable' ? 'nicht verfügbar' : 'wird geladen…'}</b></div><div className="flex justify-between"><span>Formel</span><span className="text-amber-200">d = 10^((Tx-RSSI)/(10·n))</span></div><p className="text-slate-500">Nur gemessene RSSI- und TxPower-Werte werden berechnet.</p></div>
            </div>
          </div>

          <NetworkDiagnostics />
          <MeshControl />
          <ReplayEditor />
          <RosettaPanel />
        </section>

        <aside className={`flex flex-col gap-5 ${menuOpen ? 'hidden md:flex' : 'flex'}`}>
          <PairingPanel onBind={handleBind} />
          <div className="glass-card p-5">
            <h3 className="text-sm font-black text-white mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /> Details</h3>
            {selectedDevice ? <div className="text-xs font-mono space-y-1.5 text-slate-300"><div className="flex justify-between"><span className="text-slate-500">ID</span><b className="text-cyan-200 truncate ml-3">{selectedDevice.id}</b></div><div className="flex justify-between"><span className="text-slate-500">Quelle</span><b>{selectedDevice.source}</b></div><div className="flex justify-between"><span className="text-slate-500">RSSI</span><b className="text-cyan-200">{selectedDevice.rssi !== undefined ? `${selectedDevice.rssi} dBm` : 'nicht verfügbar'}</b></div><div className="flex justify-between"><span className="text-slate-500">TxPower</span><b className="text-amber-200">{selectedDevice.txPower !== undefined ? `${selectedDevice.txPower} dBm` : 'nicht verfügbar'}</b></div><div className="flex justify-between"><span className="text-slate-500">Anzeige-Position</span><b className="text-violet-300">({selectedDevice.x.toFixed(2)}, {selectedDevice.y.toFixed(2)}, {selectedDevice.z.toFixed(2)})</b></div><div className="text-[10px] text-slate-500 pt-2">Beobachtet: {new Date(selectedDevice.observedAt).toLocaleString()}</div></div> : <div className="text-xs text-slate-500 italic">Ein Gerät in der 3D-Ansicht oder Kartenliste wählen.</div>}
          </div>
          <div className="glass-card p-5"><h3 className="text-sm font-black text-white mb-3 flex items-center gap-2"><Waves className="w-4 h-4 text-violet-300" /> Gebundene Clients</h3>{boundClients.length === 0 ? <div className="text-xs text-slate-500 italic">Noch keine Kopplung.</div> : <div className="flex flex-col gap-2">{boundClients.map((client) => <div key={client.id} className="bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-3 py-2 text-xs"><b className="text-emerald-100">{client.name}</b><div className="text-[10px] font-mono text-emerald-300 mt-1">{client.method.toUpperCase()} · {client.verified ? 'verifiziert' : 'nicht verifiziert'}</div></div>)}</div>}</div>
          <NetworkSettings config={{ defaultMode: 'ble', scanIntervalMs: 2000, bleTxPower: -59, bleEnvFactor: 2.0, sensorTimeoutMs: 1000, meshIntervalMs: 2000, meshFreqStart: 2400, meshFreqEnd: 2500, pairingMethods: { qr: true, ble: true, nfc: true, wifi: true }, wasmCalibrationRssiRef: -59, wasmCalibrationDistRef: 2.0 }} onChange={() => undefined} />
        </aside>
      </main>

      <footer className="border-t border-white/10 py-4 text-center text-[11px] text-slate-600 font-mono bg-[#020617]/60">DinGelSchwinG • NEXUS-BUILDER • physische Beobachtungen via Gateway / QR / NFC</footer>
      <div className="md:hidden fixed bottom-16 left-3 z-50 flex flex-col gap-2">{panelActions.map(([id, icon, title]) => <button type="button" key={id} onClick={() => setPanel(panel === id ? null : id)} title={title} className="w-11 h-11 rounded-full bg-slate-800/90 text-base shadow-xl ring-1 ring-white/15">{icon}</button>)}</div>
      {agentOpen && <AgentConsole role="admin" onClose={() => setAgentOpen(false)} />}
      {panel === 'gallery' && <AgentGalleryPanel onClose={() => setPanel(null)} />}
      {panel === 'dashboard' && <LiveDashboardPanel onClose={() => setPanel(null)} />}
      {panel === 'knowledge' && <KnowledgeBasePanel onClose={() => setPanel(null)} />}
      {panel === 'mcp' && <McpServerPanel onClose={() => setPanel(null)} />}
      {panel === 'portview' && <PortViewPanel onClose={() => setPanel(null)} />}
      {panel === 'devices' && <DevicePortViewPanel onClose={() => setPanel(null)} />}
      {panel === 'flash' && <FlashCenterPanel onClose={() => setPanel(null)} />}
      {panel === 'grabber' && <AssetGrabberPanel onClose={() => setPanel(null)} />}
    </div>
  );
}
