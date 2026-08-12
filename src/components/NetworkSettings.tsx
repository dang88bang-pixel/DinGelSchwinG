import { useState, useCallback } from 'react';
import { SlidersHorizontal, Wifi, Bluetooth, Activity, Save } from 'lucide-react';

export interface NetworkConfig {
  defaultMode: 'ble' | 'wifi' | 'usb';
  scanIntervalMs: number;
  bleTxPower: number;
  bleEnvFactor: number;
  sensorTimeoutMs: number;
  meshIntervalMs: number;
  meshFreqStart: number;
  meshFreqEnd: number;
  pairingMethods: { qr: boolean; ble: boolean; nfc: boolean; wifi: boolean };
  wasmCalibrationRssiRef: number;
  wasmCalibrationDistRef: number;
}

const DEFAULT_CONFIG: NetworkConfig = {
  defaultMode: 'ble',
  scanIntervalMs: 2000,
  bleTxPower: -59,
  bleEnvFactor: 2.0,
  sensorTimeoutMs: 1000,
  meshIntervalMs: 2000,
  meshFreqStart: 2400,
  meshFreqEnd: 2500,
  pairingMethods: { qr: true, ble: true, nfc: true, wifi: true },
  wasmCalibrationRssiRef: -59,
  wasmCalibrationDistRef: 2.0,
};

export default function NetworkSettings({ config, onChange }: { config: NetworkConfig; onChange: (c: NetworkConfig) => void }) {
  const [local, setLocal] = useState<NetworkConfig>({ ...config });
  const [saved, setSaved] = useState(false);

  const update = useCallback(<K extends keyof NetworkConfig>(key: K, value: NetworkConfig[K]) => {
    setLocal(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(() => {
    onChange(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [local, onChange]);

  const handleReset = useCallback(() => {
    setLocal({ ...DEFAULT_CONFIG });
    onChange({ ...DEFAULT_CONFIG });
    setSaved(false);
  }, [onChange]);

  return (
    <div className="glass-card p-5 relative overflow-hidden ring-gradient">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-300/10 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-white flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-amber-300" /> Netzwerk-Konfiguration</h3>
        <div className="flex gap-2">
          <button onClick={handleReset} className="text-[10px] font-extrabold px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-rose-900 border border-slate-700">Zurücksetzen</button>
          <button onClick={handleSave} className="text-[10px] font-extrabold px-3 py-0.5 rounded bg-gradient-to-br from-amber-600 to-violet-700 text-white shadow-lg hover:brightness-110 flex items-center gap-1"><Save className="w-3 h-3" /> {saved ? 'Gespeichert' : 'Speichern'}</button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Modus & Scan */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="text-[10px] font-extrabold text-amber-300 uppercase tracking-wide mb-2 flex items-center gap-1"><Wifi className="w-3 h-3" /> Modus</div>
          <select value={local.defaultMode} onChange={e => update('defaultMode', e.target.value as any)} className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white font-mono mb-2">
            <option value="ble">BLE</option>
            <option value="wifi">WiFi</option>
            <option value="usb">USB / NW</option>
          </select>
          <div className="text-[10px] text-slate-400 mb-0.5">Scan-Intervall (ms)</div>
          <input type="range" min={500} max={10000} step={500} value={local.scanIntervalMs} onChange={e => update('scanIntervalMs', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400" />
          <div className="text-[10px] font-mono text-slate-300">{local.scanIntervalMs} ms</div>
        </div>

        {/* BLE / WASM */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="text-[10px] font-extrabold text-cyan-300 uppercase tracking-wide mb-2 flex items-center gap-1"><Bluetooth className="w-3 h-3" /> BLE / WASM</div>
          <div className="text-[10px] text-slate-400 mb-0.5">Tx Power (dBm)</div>
          <input type="number" value={local.bleTxPower} onChange={e => update('bleTxPower', parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-cyan-200 mb-2" />
          <div className="text-[10px] text-slate-400 mb-0.5">Umgebungsfaktor n</div>
          <input type="number" step="0.1" min={1.5} max={6} value={local.bleEnvFactor} onChange={e => update('bleEnvFactor', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-amber-200 mb-2" />
          <div className="text-[10px] text-slate-400 mb-0.5">Kalibrierung RSSI</div>
          <input type="number" value={local.wasmCalibrationRssiRef} onChange={e => update('wasmCalibrationRssiRef', parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200 mb-1" />
          <div className="text-[10px] text-slate-400">Kalibrierung Distanz (m)</div>
          <input type="number" step="0.1" value={local.wasmCalibrationDistRef} onChange={e => update('wasmCalibrationDistRef', parseFloat(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200" />
        </div>

        {/* Sensors / Mesh / Pairing */}
        <div className="rounded-2xl p-3 bg-[#060f2a]/60 border border-white/5">
          <div className="text-[10px] font-extrabold text-violet-300 uppercase tracking-wide mb-2 flex items-center gap-1"><Activity className="w-3 h-3" /> Activity / Mesh / Pairing</div>
          <div className="text-[10px] text-slate-400 mb-0.5">Activity-Timeout (ms)</div>
          <input type="number" value={local.sensorTimeoutMs} onChange={e => update('sensorTimeoutMs', parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200 mb-2" />
          <div className="text-[10px] text-slate-400 mb-0.5">Mesh-Intervall (ms)</div>
          <input type="number" value={local.meshIntervalMs} onChange={e => update('meshIntervalMs', parseInt(e.target.value))} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200 mb-2" />
          <div className="text-[10px] text-slate-400 mb-1">Mesh-Frequenz (MHz)</div>
          <div className="flex gap-2 mb-2">
            <input type="number" value={local.meshFreqStart} onChange={e => update('meshFreqStart', parseInt(e.target.value))} className="w-1/2 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200" />
            <input type="number" value={local.meshFreqEnd} onChange={e => update('meshFreqEnd', parseInt(e.target.value))} className="w-1/2 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-violet-200" />
          </div>
          <div className="text-[10px] text-slate-400 mb-1">Paarungsmethoden</div>
          <div className="flex gap-2">
            {(['qr','ble','nfc','wifi'] as const).map(m => (
              <button key={m} onClick={() => update('pairingMethods', { ...local.pairingMethods, [m]: !local.pairingMethods[m] })} className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${local.pairingMethods[m] ? 'bg-violet-600 text-white border-violet-400' : 'bg-slate-900 text-slate-400 border-slate-700'}`}>{m.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
