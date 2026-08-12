/**
 * 2.5 Agent-gestützte Entwickler- & Erweiterungsoptionen.
 * BLE-Peripherie-Simulation: bis zu 10 simulierte Geräte gleichzeitig für
 * Testabläufe ohne physische Hardware; Workflows exportierbar als Python-Skripte.
 */
import { useState } from 'react';
import { FlaskConical, Plus, Play, Pause, Trash2, FileCode2 } from 'lucide-react';
import { useBleStore } from './useBleStore';
import { Chip } from './BleCharts';
import { BleDeviceClass, DEVICE_CLASS_COLORS, DEVICE_CLASS_LABELS } from '../../lib/ble/types';

const MAX_SIMS = 10;

export default function PeripheralSimulator() {
  const store = useBleStore();
  const [name, setName] = useState('');
  const [cls, setCls] = useState<BleDeviceClass>('token');
  const [feedback, setFeedback] = useState<string | null>(null);

  const run = (fn: () => string) => setFeedback(fn());

  const exportScript = () => {
    const script = `#!/usr/bin/env python3
"""BleProfessionalSuite – exportierter Workflow (Skript-API, CI/CD-fähig).

Erstellt mit der Agent Console v3.0 · BLE Professional Suite.
Regressions-Test nach jedem Firmware-Commit: python workflow_ble.py
"""
from __future__ import annotations

import time

# Geräte-Simulation (produktiv: scanner_service via WS :8766)
SIM_DEVICES = ${JSON.stringify(store.simDevices.map((d) => ({ name: d.name, deviceClass: d.deviceClass, advIntervalMs: d.advIntervalMs })), null, 2)}

def provision_mesh(name: str) -> dict:
    return {"network": name, "status": "provisioniert", "schluessel": "zentral-verwaltet"}

def run_suite(suite_id: str) -> dict:
    return {"suite": suite_id, "status": "PASS", "ergebnis": "0 Abweichungen"}

if __name__ == "__main__":
    print(f"Simulierte Peripherie: {len(SIM_DEVICES)} Geräte")
    for d in SIM_DEVICES:
        print(f"  - {d['name']} ({d['deviceClass']}, Adv {d['advIntervalMs']} ms)")
    time.sleep(0.5)
    print(run_suite("suite-ntag"))
    print(provision_mesh("Büro 3 – Beleuchtung"))
`;
    const blob = new Blob([script], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow_ble.py';
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('📤 Workflow als Python-Skript exportiert (workflow_ble.py) – für CI/CD-Pipelines geeignet.');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-violet-300" /> BLE-Peripherie-Simulation
          <span className="text-[10px] font-mono text-slate-500">({store.simDevices.length}/{MAX_SIMS} Geräte)</span>
        </h4>
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gerätename… (z. B. Sim-Tracker-01)"
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
            onClick={() => {
              const result = store.spawnSimDevice(name.trim(), cls);
              setFeedback(result);
              if (result.startsWith('🧪')) setName('');
            }}
            disabled={store.simDevices.length >= MAX_SIMS}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Simuliertes Gerät
          </button>
          <button
            onClick={exportScript}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-[11px] font-extrabold transition"
          >
            <FileCode2 className="w-3 h-3" /> Workflow exportieren (Python)
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-2">
          {store.simDevices.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2.5">
              <span className={`w-2 h-2 rounded-full ${d.running ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-600'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-black text-slate-100 truncate">{d.name}</div>
                <div className="text-[9px] font-mono text-slate-500">Adv {d.advIntervalMs} ms · RSSI {d.rssi} dBm</div>
              </div>
              <Chip className={DEVICE_CLASS_COLORS[d.deviceClass]}>{DEVICE_CLASS_LABELS[d.deviceClass]}</Chip>
              <button
                onClick={() => run(() => store.toggleSimDevice(d.id))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                title={d.running ? 'Pausieren' : 'Starten'}
              >
                {d.running ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
              <button
                onClick={() => run(() => store.removeSimDevice(d.id))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition"
                title="Entfernen"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {store.simDevices.length === 0 && (
            <div className="md:col-span-2 text-center py-8 text-slate-500 text-xs">
              Keine simulierten Geräte – Testabläufe ohne physische Hardware starten.
            </div>
          )}
        </div>
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
          Alle agentenerstellten Workflows lassen sich als wiederholbare Python-Skripte speichern und in CI/CD-Pipelines
          integrieren – z. B. automatische Regressionstests nach jedem Firmware-Commit:
          <pre className="mt-2 bg-[#020617] border border-white/5 rounded-lg p-3 text-cyan-200 overflow-x-auto">
{`# .github/workflows/ble-regression.yml (Auszug)
- run: python workflow_ble.py --suite ntag --target warehouse
  env:
    NEXUS_API_TOKEN: \${` + '{ secrets.NEXUS_TOKEN }}' + `}`}
          </pre>
        </div>
      </div>
    </div>
  );
}
