/**
 * 2.5 Agent-gestützte Entwickler- & Erweiterungsoptionen.
 * BLE-Peripherie-Erzeugung: echte GATT-Server auf dem Host (protokollkorrekter
 * ATT-Stapel, /api/ble/virtual) – keine Mocks. Lokale Store-Simulation nur als
 * Offline-Fallback, klar gebadged.
 */
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Plus, Trash2, FileCode2, Server, Loader2, Plug } from 'lucide-react';
import { useBleStore } from './useBleStore';
import { Chip } from './BleCharts';
import { api, VirtualPeripheral } from '../../lib/api/client';
import { BleDeviceClass, DEVICE_CLASS_COLORS, DEVICE_CLASS_LABELS } from '../../lib/ble/types';

const MAX_SIMS = 10;

export default function PeripheralSimulator() {
  const store = useBleStore();
  const [name, setName] = useState('');
  const [cls, setCls] = useState<BleDeviceClass>('token');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [hostDevices, setHostDevices] = useState<VirtualPeripheral[]>([]);
  const [busy, setBusy] = useState(false);

  const refreshHost = useCallback(async () => {
    const ok = await api.ensureHost();
    setHostOnline(ok);
    if (ok) {
      try {
        setHostDevices(await api.virtualList());
      } catch {
        setHostDevices([]);
      }
    }
  }, []);

  useEffect(() => {
    refreshHost();
    const timer = window.setInterval(refreshHost, 15000);
    return () => window.clearInterval(timer);
  }, [refreshHost]);

  const run = (fn: () => string) => setFeedback(fn());

  // Echter GATT-Server auf dem Host erzeugen (protokollkorrekter ATT-Stapel)
  const spawnHost = async () => {
    setBusy(true);
    try {
      const ok = await api.ensureHost();
      if (!ok) {
        setFeedback('❌ Host nicht erreichbar – Start: python3 -m host.main');
        return;
      }
      const dev = await api.virtualSpawn(name.trim() || `Virt-${cls}`, cls, 3.0);
      setHostDevices(await api.virtualList());
      store.importHostDevices([{ id: dev.id, name: dev.name, rssi: dev.rssi, deviceClass: cls }]);
      setFeedback(`✅ Echter GATT-Server '${dev.name}' auf dem Host erstellt (ATT, Port ${dev.port}, RSSI ${dev.rssi} dBm)`);
      setName('');
    } catch (e) {
      setFeedback(`❌ ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const removeHost = async (id: string) => {
    await api.virtualRemove(id);
    setHostDevices(await api.virtualList());
  };

  // Host-Gerät per echter ATT-Session verbinden
  const connectHost = async (id: string) => {
    try {
      const res = await api.bleConnect(id, 'connect');
      setFeedback(res.message ?? JSON.stringify(res));
    } catch (e) {
      setFeedback(`❌ ${String(e)}`);
    }
  };

  const exportScript = () => {
    const script = `#!/usr/bin/env python3
"""BleProfessionalSuite – exportierter Workflow (Skript-API, CI/CD-fähig).

Verwendet die Host-API (protokollkorrekter BLE-Stapel): virtuelle Peripherals
sind echte GATT-Server über ATT/TCP – keine Mocks.
"""
import json, urllib.request

BASE = "http://localhost:5000"

def login():
    req = urllib.request.Request(BASE + "/api/login",
        data=json.dumps({"email": "developer", "password": "dev123"}).encode(),
        headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["token"]

def spawn(name, device_class):
    req = urllib.request.Request(BASE + "/api/ble/virtual",
        data=json.dumps({"name": name, "deviceClass": device_class}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {login()}"})
    return json.load(urllib.request.urlopen(req))

if __name__ == "__main__":
    for c in ("ntag", "token"):
        dev = spawn(f"CI-{c}", c)
        print(f"  - {dev['name']} (Port {dev['port']}, RSSI {dev['rssi']} dBm)")
`;
    const blob = new Blob([script], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow_ble.py';
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('📤 Workflow als Python-Skript exportiert (workflow_ble.py) – nutzt echte Host-GATT-Server.');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-violet-300" /> BLE-Peripherie (echte GATT-Server)
          <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full border ${
            hostOnline ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40' : 'text-amber-300 border-amber-700/40 bg-amber-950/40'
          }`}>
            {hostOnline ? '● Host: protokollkorrekter ATT-Stapel' : '○ Host offline – lokaler Fallback'}
          </span>
        </h4>

        {/* Host-Pfad (aktiv, wenn Host erreichbar) */}
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gerätename… (z. B. Virt-Tracker-01)"
            className="flex-1 min-w-[180px] bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 placeholder:text-slate-500 outline-none focus:border-violet-400/50"
          />
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value as BleDeviceClass)}
            className="bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900"
          >
            {(Object.keys(DEVICE_CLASS_LABELS) as BleDeviceClass[]).map((c) => (
              <option key={c} value={c}>{DEVICE_CLASS_LABELS[c]}</option>
            ))}
          </select>
          <button
            onClick={spawnHost}
            disabled={busy || !hostOnline}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
            Host-GATT-Server erzeugen
          </button>
          <button
            onClick={exportScript}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-[11px] font-extrabold transition"
          >
            <FileCode2 className="w-3 h-3" /> Workflow exportieren (Python)
          </button>
        </div>

        {/* Echte Host-Peripherals */}
        {hostDevices.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] font-black text-emerald-300 uppercase tracking-wide mb-1.5">
              Echte GATT-Server auf dem Host ({hostDevices.length})
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              {hostDevices.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-emerald-700/30 bg-emerald-950/20 px-3 py-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-black text-slate-100 truncate">{d.name}</div>
                    <div className="text-[9px] font-mono text-emerald-300/70">
                      ATT-Port {d.port} · RSSI {d.rssi} dBm · Akku {d.battery}% · Uptime {d.uptime_s}s
                    </div>
                  </div>
                  <Chip className={DEVICE_CLASS_COLORS[clsFor(d) ?? 'token']}>{d.serviceUuids.length} Service(s)</Chip>
                  <button
                    onClick={() => connectHost(d.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-emerald-800/60 text-slate-300 hover:text-emerald-200 transition"
                    title="ATT-Session verbinden"
                  >
                    <Plug className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeHost(d.id)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition"
                    title="Entfernen"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lokaler Fallback (nur offline) */}
        {!hostOnline && (
          <div className="rounded-xl border border-amber-800/30 bg-amber-950/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black text-amber-200 uppercase tracking-wide">
                Lokale Store-Liste (Offline-Fallback)
              </span>
              <button
                onClick={() => {
                  const result = store.spawnSimDevice(name.trim() || `Sim-${cls}`, cls);
                  setFeedback(result);
                  if (result.startsWith('🧪')) setName('');
                }}
                disabled={store.simDevices.length >= MAX_SIMS}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-800/40 hover:bg-amber-700/40 text-amber-100 text-[10px] font-extrabold transition disabled:opacity-40"
              >
                <Plus className="w-3 h-3" /> Sim-Eintrag
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              {store.simDevices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded-lg bg-slate-900/50 border border-white/5 px-3 py-2">
                  <span className={`w-2 h-2 rounded-full ${d.running ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                  <span className="text-[11px] font-bold text-slate-100 truncate">{d.name}</span>
                  <Chip className={DEVICE_CLASS_COLORS[d.deviceClass]}>{DEVICE_CLASS_LABELS[d.deviceClass]}</Chip>
                  <button
                    onClick={() => run(() => store.removeSimDevice(d.id))}
                    className="p-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {store.simDevices.length === 0 && (
                <div className="md:col-span-2 text-[10px] text-slate-500">Keine lokalen Sim-Einträge.</div>
              )}
            </div>
          </div>
        )}

        {feedback && (
          <div className="mt-3 text-[10px] font-mono text-violet-200 bg-violet-950/30 border border-violet-800/30 rounded-lg px-3 py-2">
            {feedback}
          </div>
        )}
      </div>

      {/* Skript-API Info */}
      <div className="rounded-2xl border border-cyan-800/30 bg-cyan-950/20 p-4">
        <h4 className="text-xs font-black text-cyan-100 mb-2 flex items-center gap-2">
          <FileCode2 className="w-3.5 h-3.5 text-cyan-300" /> Skript-API & CI/CD
        </h4>
        <div className="text-[10px] font-mono text-slate-300 leading-relaxed">
          Workflows laufen gegen die Host-API (echte ATT-GATT-Server) und sind als Python-Skripte
          exportierbar – Regressionstests nach jedem Firmware-Commit nutzen echte Protokoll-Transaktionen.
        </div>
      </div>
    </div>
  );
}

function clsFor(d: VirtualPeripheral): BleDeviceClass | null {
  if (d.serviceUuids.some((u) => u.startsWith('0000fea9'))) return 'ntag';
  if (d.serviceUuids.some((u) => u.startsWith('00001827'))) return 'mesh';
  if (d.serviceUuids.some((u) => u.startsWith('0000180f') || u.startsWith('00001812'))) return 'token';
  return null;
}
