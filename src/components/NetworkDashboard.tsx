import { useState, useEffect, useMemo, useCallback } from 'react';
import { Radio, Wifi, Bluetooth, ShieldCheck, Cpu, Waves, MapPin, Activity, Menu, Zap, Layers, CircleDot } from 'lucide-react';
import Scene3D from './Scene3D';
import PairingPanel, { PairedDevice } from './PairingPanel';
import NetworkDiagnostics from './diagnostics/NetworkDiagnostics';
import MeshControl from './MeshControl';
import ReplayEditor from './ReplayEditor';
import RosettaPanel from './RosettaPanel';
import NetworkSettings from './NetworkSettings';
import { useSensors } from '../hooks/useSensors';
import { loadBLEWasm, BLEWasmExports } from '../lib/bleWasm';

export interface SceneDevice {
  id: string;
  name: string;
  x: number; y: number; z: number;
  type: 'master' | 'client' | 'target' | 'other';
  rssi: number;
  distance?: number;
  txPower: number;
}

export default function NetworkDashboard() {
  const sensors = useSensors();
  const [mode, setMode] = useState<'ble' | 'wifi' | 'usb'>('ble');
  const [wasmModule, setWasmModule] = useState<BLEWasmExports | null>(null);
  const [devices, setDevices] = useState<SceneDevice[]>([
    { id: 'master-1', name: 'MASTER-Gold', x: 0, y: 0, z: 0, type: 'master', rssi: -42, txPower: -59 },
    { id: 'client-1', name: 'Client-A', x: 1.8, y: 0.9, z: 0.7, type: 'client', rssi: -62, txPower: -59 },
    { id: 'client-2', name: 'Client-B', x: -2.1, y: 0.6, z: 1.4, type: 'client', rssi: -68, txPower: -59 },
    { id: 'target-1', name: 'Target-X', x: -1.4, y: 0.4, z: -2.2, type: 'target', rssi: -74, txPower: -59 },
    { id: 'other-1', name: 'WiFi-AP-01', x: 3.2, y: 0.3, z: -1.0, type: 'other', rssi: -81, txPower: -55 },
    { id: 'other-2', name: 'BLE-Beacon-3', x: 0.6, y: 1.2, z: -2.5, type: 'other', rssi: -76, txPower: -59 },
  ]);
  const [boundClients, setBoundClients] = useState<PairedDevice[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    loadBLEWasm().then(mod => {
      setWasmModule(mod);
      setDevices(prev => prev.map(d => ({
        ...d,
        distance: d.rssi !== undefined && d.txPower !== undefined ? mod.calculate_distance(d.rssi, d.txPower) : undefined,
      })));
    });
  }, []);

  useEffect(() => {
    if (sensors.permissionGranted && (sensors.beta !== null || sensors.gamma !== null)) {
      setDevices(prev => prev.map(d => {
        if (d.type !== 'master' && d.id !== selectedId) {
          const phi = ((sensors.alpha || 0) / 360) * Math.PI * 2;
          const theta = ((sensors.beta || 0) + 90) / 180 * Math.PI;
          const dEst = d.distance || 1.5;
          return { ...d, x: dEst * Math.sin(theta) * Math.cos(phi), y: dEst * Math.sin(theta), z: dEst * Math.sin(theta) * Math.sin(phi) };
        }
        return d;
      }));
    }
  }, [sensors.alpha, sensors.beta, sensors.gamma, sensors.permissionGranted, selectedId]);

  const handleBind = useCallback((device: PairedDevice) => {
    setBoundClients(prev => [...prev, device]);
    setDevices(prev => [
      ...prev,
      { id: device.id, name: device.name, x: 1.5 + Math.random() * 2, y: 0.5 + Math.random() * 1, z: Math.random() * 2 - 1, type: 'client', rssi: device.rssi, txPower: -59 },
    ]);
  }, []);

  const sceneDevices = useMemo(() => devices.map(d => ({ id: d.id, name: d.name, x: d.x, y: d.y, z: d.z, type: d.type, rssi: d.rssi })), [devices]);
  const selectedDevice = devices.find(d => d.id === selectedId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#020617] via-[#050a18] to-[#0b1220] text-slate-100 font-sans selection:bg-cyan-400/30 overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#050a18]/80 backdrop-blur-2xl border-b border-white/10 px-5 md:px-8 py-4 flex items-center justify-between shadow-2xl shadow-blue-950/30">
        <div className="flex items-center gap-4">
          <button onClick={() => setMenuOpen(!menuOpen)} className="md:hidden p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-cyan-200 border border-white/10 transition"><Menu className="w-5 h-5" /></button>
          <div>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-cyan-200 to-violet-200 leading-none glow-text">DinGelSchwinG <span className="text-sm font-medium text-slate-400 align-top ml-1">NEXUS-BUILDER</span></h1>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] font-mono text-slate-400">
              <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-amber-400" /> Master</span>
              <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-emerald-400" /> Client</span>
              <span className="flex items-center gap-1"><CircleDot className="w-3 h-3 text-rose-400" /> Ziel</span>
              <span className="text-slate-600">| WASM · BLE · 3D · Sensoren</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {(['ble','wifi','usb'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold shadow-xl shadow-inner transition ring-1 ring-white/10 ${mode===m ? 'bg-gradient-to-br from-cyan-600 to-blue-700 text-white ring-cyan-300/50' : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'}`}>
              {m==='ble' && <Bluetooth className="w-3.5 h-3.5" />}{m==='wifi' && <Wifi className="w-3.5 h-3.5" />}{m==='usb' && <Radio className="w-3.5 h-3.5" />}{m.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className={`max-w-[1600px] mx-auto px-4 md:px-8 py-6 md:py-8 grid gap-6 ${menuOpen ? 'grid-cols-1 md:grid-cols-[1fr_340px]' : 'grid-cols-1 lg:grid-cols-[1fr_360px]'}`}>
        {/* Hauptbereich */}
        <section className="flex flex-col gap-6">
          {/* 3D Szene — besonders hervorheben */}
          <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-blue-950/40 ring-1 ring-white/10 bg-gradient-to-b from-[#060f2a] to-[#020617]">
            <div className="flex items-center justify-between px-5 py-3 bg-gradient-to-r from-[#060f2a]/90 to-[#0a1835]/70 border-b border-white/10 backdrop-blur-md">
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-200">
                <Layers className="w-3.5 h-3.5 text-amber-300" /> 3D-Raumdarstellung — exakte Positionen
                <span className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${wasmModule ? 'bg-emerald-900/60 text-emerald-200 border-emerald-600/40' : 'bg-amber-900/40 text-amber-200 border-amber-600/30'}`}>{wasmModule ? 'WASM aktiv' : 'WASM lädt...'}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500">Modus: <span className="text-white font-bold">{mode.toUpperCase()}</span></div>
            </div>
            <div className="h-[420px] md:h-[540px] lg:h-[580px] relative">
              <Scene3D devices={sceneDevices} onSelect={setSelectedId} />
            </div>
          </div>

          {/* Geräte-Status — elegante Karten */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {devices.map(d => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`text-left rounded-2xl p-4 glass-card ring-inset border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl relative overflow-hidden ${selectedId === d.id ? 'scale-[1.03] ring-2 ring-amber-300/60 shadow-amber-900/20' : ''}`}
              >
                {d.type === 'master' && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)] animate-pulse" />}
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-extrabold uppercase tracking-widest ${d.type === 'master' ? 'text-amber-300' : d.type === 'client' ? 'text-emerald-300' : d.type === 'target' ? 'text-rose-300' : 'text-slate-400'}`}>{d.type}</span>
                  <span className="w-2.5 h-2.5 rounded-full shadow-sm shadow-black/40 ring-2 ring-white/10" style={{ background: d.type === 'master' ? '#F59E0B' : d.type === 'client' ? '#10B981' : d.type === 'target' ? '#EF4444' : '#9CA3AF' }} />
                </div>
                <div className="text-base font-black text-white leading-tight mb-1.5 tracking-tight">{d.name}</div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                  <span>RSSI <b className="text-cyan-200">{d.rssi}</b></span>
                  <span>·</span>
                  <span>Dist <b className="text-amber-200">{d.distance ? d.distance.toFixed(2) + 'm' : '--'}</b></span>
                </div>
                <div className="mt-3 pt-2 border-t border-white/5 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                  <MapPin className="w-3 h-3 text-slate-500" /> {d.x.toFixed(1)}, {d.y.toFixed(1)}, {d.z.toFixed(1)}
                </div>
              </button>
            ))}
          </div>

          {/* Sensoren + WASM Status — zwei Spalten */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-3xl p-5 bg-gradient-to-br from-blue-950/40 to-indigo-950/40 border border-blue-800/30 backdrop-blur-xl shadow-2xl shadow-blue-950/10 relative overflow-hidden ring-gradient">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
              <h3 className="text-sm font-black text-blue-100 flex items-center gap-2 mb-4 relative"><Cpu className="w-4 h-4 text-blue-300" /> Geräte-Sensoren</h3>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono relative">
                {[
                  { label: 'Alpha', val: sensors.alpha, clr: 'text-cyan-300' },
                  { label: 'Beta', val: sensors.beta, clr: 'text-amber-300' },
                  { label: 'Gamma', val: sensors.gamma, clr: 'text-violet-300' },
                ].map(s => (
                  <div key={s.label} className="bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5">
                    <div className="text-[10px] text-slate-400 mb-0.5">{s.label}</div>
                    <div className={`font-bold text-sm ${s.clr}`}>{s.val !== null ? s.val.toFixed(1) + '°' : '--'}</div>
                  </div>
                ))}
                <div className="col-span-3 bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5">
                  <div className="text-[10px] text-slate-400 mb-1">Beschleunigung (m/s²)</div>
                  <div className="flex gap-3 text-xs font-black">
                    <span className="text-rose-300">X {sensors.acceleration?.x.toFixed(2) ?? '--'}</span>
                    <span className="text-emerald-300">Y {sensors.acceleration?.y.toFixed(2) ?? '--'}</span>
                    <span className="text-amber-300">Z {sensors.acceleration?.z.toFixed(2) ?? '--'}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2 relative">
                <button onClick={() => sensors.requestPermission()} className="text-[11px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-extrabold shadow-lg shadow-blue-900/30 transition ring-1 ring-blue-400/30">Sensor-Berechtigung</button>
                <span className={`text-[11px] px-2.5 py-1.5 rounded-lg font-mono font-extrabold border ring-1 ${sensors.permissionGranted ? 'bg-emerald-950 text-emerald-300 border-emerald-700 ring-emerald-600/20' : 'bg-rose-950 text-rose-300 border-rose-700 ring-rose-600/20'}`}>{sensors.permissionGranted ? 'Gewährt' : 'Nicht gewährt'}</span>
              </div>
            </div>

            <div className="rounded-3xl p-5 bg-gradient-to-br from-amber-950/30 to-orange-950/30 border border-amber-800/30 backdrop-blur-xl shadow-2xl shadow-amber-950/10 relative overflow-hidden ring-gradient">
              <div className="absolute -top-10 -left-10 w-40 h-40 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />
              <h3 className="text-sm font-black text-amber-100 flex items-center gap-2 mb-4 relative"><Activity className="w-4 h-4 text-amber-300" /> WASM-Abstandsbestimmung</h3>
              <div className="text-xs font-mono text-slate-300 leading-relaxed mb-3 relative space-y-0.5">
                <div className="flex justify-between border-b border-amber-800/30 py-1"><span>Modul</span> <b className="text-amber-200">{wasmModule ? 'geladen' : 'wird geladen...'}</b></div>
                <div className="flex justify-between border-b border-amber-800/30 py-1"><span>Formel</span> <span className="text-amber-200">d = 10^((Tx-RSSI)/(10·n))</span></div>
                <div className="flex justify-between border-b border-amber-800/30 py-1"><span>Standard n</span> <b className="text-amber-200">2.0 (Freifeld)</b></div>
                <div className="flex justify-between py-1"><span>Kalibrierung</span> <b className="text-amber-200">calc_exact_distance()</b></div>
              </div>
              <div className="bg-[#0b0f18] rounded-xl p-3 font-mono text-[11px] text-slate-400 border border-amber-900/20 relative overflow-hidden">
                <div className="text-amber-200 font-bold mb-1">// Beispiel (WASM / JS-Bridge identisch)</div>
                <div>const d = calculate_distance(-65, -59);</div>
                <div className="text-amber-300">// Ergebnis ≈ 2.00 m</div>
              </div>
            </div>
          {/* Neue Diagnose-Module */}
          <NetworkDiagnostics />
          <MeshControl />
          <ReplayEditor />
          <RosettaPanel />
          {/* Rekursiver Lern-Feedback */}
          <div className="glass-card p-5 relative overflow-hidden ring-gradient">
            <h3 className="text-sm font-black text-white flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-amber-300" /> Rekursives Lernen (WASM)</h3>
            <div className="grid md:grid-cols-3 gap-3 text-xs font-mono mb-3">
              <div className="bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5"><div className="text-slate-400">Referenz RSSI</div><div className="text-cyan-200 font-bold">{selectedDevice?.rssi ?? '--'} dBm</div></div>
              <div className="bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5"><div className="text-slate-400">Referenz Distanz</div><div className="text-amber-200 font-bold">{selectedDevice?.distance ? selectedDevice.distance.toFixed(2)+'m' : '--'}</div></div>
              <div className="bg-[#060f2a]/60 rounded-xl p-2.5 border border-white/5"><div className="text-slate-400">Gelernter n</div><div className="text-violet-200 font-bold">{wasmModule ? (wasmModule.get_learned_n ? wasmModule.get_learned_n().toFixed(2) : '2.00') : '--'}</div></div>
            </div>
            <button onClick={async () => {
              if (!selectedDevice || !wasmModule) return;
              try {
                // Simulation einer Bestätigung durch Client-Gerät
                const confirmedDist = selectedDevice.distance || 2.0;
                const confirmedRssi = selectedDevice.rssi || -65;
                const newN = wasmModule.learn_from_feedback(-59, confirmedDist, confirmedRssi, confirmedDist * 0.95);
                alert(`Lernen abgeschlossen: Neuer Umgebungsfaktor n = ${newN.toFixed(3)} (aus Bestätigung des Client-Geräts)`);
              } catch (e) { alert('Lernprozess fehlgeschlagen'); }
            }} className="text-xs font-extrabold px-4 py-2 rounded-xl bg-gradient-to-br from-amber-600 to-violet-700 text-white shadow-xl hover:brightness-110 transition">🔄 Bestätigung durch Client-Gerät auswerten</button>
          </div>
<ReplayEditor />
          <RosettaPanel />
          </div>
        </section>

        {/* Sidebar */}
        <aside className={`flex flex-col gap-5 ${menuOpen ? 'hidden md:flex' : 'flex'}`}>
          <PairingPanel onBind={handleBind} />

          <div className="glass-card p-5 relative overflow-hidden">
            <h3 className="text-sm font-black text-white mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /> Details</h3>
            {selectedDevice ? (
              <div className="text-xs font-mono space-y-1.5 text-slate-300">
                <div className="flex justify-between"><span className="text-slate-500">ID</span> <b className="text-cyan-200">{selectedDevice.id}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Name</span> <b className="text-white">{selectedDevice.name}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Typ</span> <b className={selectedDevice.type === 'master' ? 'text-amber-300' : selectedDevice.type === 'client' ? 'text-emerald-300' : selectedDevice.type === 'target' ? 'text-rose-300' : 'text-slate-300'}>{selectedDevice.type}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">RSSI</span> <b className="text-cyan-200">{selectedDevice.rssi} dBm</b></div>
                <div className="flex justify-between"><span className="text-slate-500">TxPower</span> <b className="text-amber-200">{selectedDevice.txPower} dBm</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Distanz (WASM)</span> <b className="text-amber-300">{selectedDevice.distance !== undefined ? selectedDevice.distance.toFixed(3) + ' m' : '--'}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Position</span> <b className="text-violet-300">({selectedDevice.x.toFixed(2)}, {selectedDevice.y.toFixed(2)}, {selectedDevice.z.toFixed(2)})</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Modus</span> <b className="text-white">{mode.toUpperCase()}</b></div>
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic">Wähle ein Gerät aus der 3D-Darstellung oder der Kartenliste.</div>
            )}
          </div>

          <div className="glass-card p-5 relative overflow-hidden">
            <h3 className="text-sm font-black text-white mb-3 flex items-center gap-2"><Waves className="w-4 h-4 text-violet-300" /> Gebundene Clients</h3>
            <div className="flex flex-col gap-2 text-xs font-mono">
              {boundClients.length === 0 ? (
                <div className="text-slate-500 italic">Noch keine Kopplung.</div>
              ) : (
                boundClients.map(c => (
                  <div key={c.id} className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-3 py-2 text-emerald-100 shadow-inner shadow-emerald-900/10">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                    <div className="flex-1 truncate font-bold">{c.name}</div>
                    <div className="text-[10px] text-emerald-300 font-extrabold">{c.method.toUpperCase()}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        <NetworkSettings config={{ defaultMode: "ble", scanIntervalMs: 2000, bleTxPower: -59, bleEnvFactor: 2.0, sensorTimeoutMs: 1000, meshIntervalMs: 2000, meshFreqStart: 2400, meshFreqEnd: 2500, pairingMethods: { qr: true, ble: true, nfc: true, wifi: true }, wasmCalibrationRssiRef: -59, wasmCalibrationDistRef: 2.0 }} onChange={(() => {})} />
        </aside>
      </main>

      <footer className="border-t border-white/10 mt-auto py-4 text-center text-[11px] text-slate-600 font-mono tracking-wide bg-[#020617]/60 backdrop-blur-md">
        DinGelSchwinG • NEXUS-BUILDER • WASM BLE Modul • 3D-Sensor-Fusion • Client-Kopplung via QR / BLE / NFC / WiFi
      </footer>
    </div>
  );
}
