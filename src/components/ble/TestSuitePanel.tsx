/**
 * 2.3 Integrierte Test- & Debugging-Suite.
 * Audit-Log, automatisierte Testabläufe (Makros, vordefinierte Suiten,
 * Durchsatz/Latenz), Paket-Sniffer und Fehlersimulation (WebAuthn-geschützt).
 */
import { useState } from 'react';
import {
  FlaskConical, Play, CircleDot, Gauge, Timer, Activity, RadioTower, Zap, Bug, Loader2,
} from 'lucide-react';
import { useBleStore } from './useBleStore';
import { Chip, ProgressBar } from './BleCharts';
import { FaultKind } from '../../lib/ble/types';
import { api, SnifferFrame } from '../../lib/api/client';

const SUITE_ICONS: Record<string, React.ReactNode> = {
  ntag: '🏷️',
  token: '🎛️',
  mesh: '🌐',
  performance: '⚡',
};

const FAULTS: Array<{ kind: FaultKind; label: string }> = [
  { kind: 'connection_drop', label: 'Verbindungsabbruch' },
  { kind: 'timeout', label: 'Timeout' },
  { kind: 'pairing_error', label: 'Pairing-Fehler' },
  { kind: 'crc_error', label: 'CRC-Fehler' },
];

export default function TestSuitePanel() {
  const store = useBleStore();
  const [faultDevId, setFaultDevId] = useState(store.devices[0]?.id ?? '');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hostFrames, setHostFrames] = useState<SnifferFrame[]>([]);
  const [hostOnline, setHostOnline] = useState(false);
  const [sniffBusy, setSniffBusy] = useState(false);

  const run = (fn: () => string) => setFeedback(fn());

  // Echte ATT-Frames vom Host-Sniffer (echter Frame-Capture des Protokolls)
  const fetchHostSniffer = async () => {
    setSniffBusy(true);
    try {
      const ok = await api.ensureHost();
      setHostOnline(ok);
      if (ok) setHostFrames(await api.snifferFrames(40));
    } catch {
      setHostFrames([]);
    } finally {
      setSniffBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Automatisierte Testabläufe */}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-emerald-300" /> Automatisierte Testabläufe
        </h4>
        <div className="grid md:grid-cols-2 gap-3">
          {store.testSuites.map((suite) => {
            const running = store.runningSuiteId === suite.id;
            const pass = suite.cases.filter((c) => c.status === 'pass').length;
            const fail = suite.cases.filter((c) => c.status === 'fail').length;
            const done = pass + fail;
            return (
              <div key={suite.id} className="rounded-xl border border-white/5 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-black text-slate-100">
                    {SUITE_ICONS[suite.kind]} {suite.name}
                  </span>
                  <button
                    onClick={() => run(() => store.runSuite(suite.id))}
                    disabled={!!store.runningSuiteId}
                    className="flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white hover:brightness-110 transition disabled:opacity-40"
                  >
                    {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                    {running ? 'läuft…' : 'Starten'}
                  </button>
                </div>
                <div className="text-[9px] font-mono text-slate-500 mb-2">{suite.description}</div>
                <div className="space-y-1 mb-2">
                  {suite.cases.map((c) => (
                    <div key={c.name} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'pass' ? 'bg-emerald-400' : c.status === 'fail' ? 'bg-rose-400' : c.status === 'running' ? 'bg-amber-300 animate-pulse' : 'bg-slate-600'}`} />
                      <span className={`flex-1 ${c.status === 'fail' ? 'text-rose-300' : 'text-slate-300'}`}>{c.name}</span>
                      <span className={`text-slate-500 ${c.status === 'fail' ? 'text-rose-400' : ''}`}>
                        {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'running' ? '…' : ''}
                      </span>
                    </div>
                  ))}
                </div>
                {done > 0 && (
                  <div className="flex items-center gap-2">
                    <ProgressBar value={done / suite.cases.length} color="from-emerald-500 to-teal-600" />
                    <span className="text-[9px] font-mono text-slate-400 whitespace-nowrap">{pass}✓ {fail}✗</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Makro + Performance */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <CircleDot className="w-3.5 h-3.5 text-violet-300" /> Makro-Aufzeichnung & -Wiedergabe
          </h4>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => run(() => store.toggleMacroRecording())}
              className={`flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg border transition ${
                store.recordingMacro
                  ? 'bg-rose-600 text-white border-rose-500/50'
                  : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
              }`}
            >
              {store.recordingMacro ? '⏹️ Aufnahme stoppen' : '⏺️ Aufnahme starten'}
            </button>
            <button
              onClick={() => run(() => store.playMacro())}
              disabled={store.macros.length === 0}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white hover:brightness-110 transition disabled:opacity-40"
            >
              <Play className="w-3 h-3" /> Wiedergabe ({store.macros.length})
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-[10px]">
            {store.macros.slice(-12).map((m) => (
              <div key={m.id} className="flex gap-2 px-2 py-1 rounded bg-slate-900/40 text-slate-400">
                <span className="text-slate-600">{m.at}</span>
                <b className="text-violet-300">{m.action}</b>
                <span className="truncate">{m.detail}</span>
              </div>
            ))}
            {store.macros.length === 0 && <div className="text-slate-600 text-center py-3">Kein Makro aufgezeichnet.</div>}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <Gauge className="w-3.5 h-3.5 text-cyan-300" /> Durchsatz- & Latenztests
          </h4>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => run(() => store.runThroughputTest(247))}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:brightness-110 transition"
            >
              <Gauge className="w-3 h-3" /> Durchsatz @ MTU 247
            </button>
            <button
              onClick={() => run(() => store.runLatencyTest(20))}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white hover:brightness-110 transition"
            >
              <Timer className="w-3 h-3" /> Latenz (20 Samples)
            </button>
          </div>
          {store.throughput && (
            <div className="text-[10px] font-mono text-cyan-200 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2 mb-2">
              📈 MTU {store.throughput.mtu}: {(store.throughput.bytesPerSec / 1024).toFixed(1)} KB/s · {store.throughput.packetsPerSec} Pkt/s · {store.throughput.windowMs} ms Fenster
            </div>
          )}
          {store.latency && (
            <div className="text-[10px] font-mono text-blue-200 bg-blue-950/30 border border-blue-800/30 rounded-lg px-3 py-2">
              ⏱️ Ø {store.latency.avgMs} ms · min {store.latency.minMs} ms · max {store.latency.maxMs} ms ({store.latency.samples} Samples)
            </div>
          )}
          <div className="mt-2 text-[9px] font-mono text-slate-600">
            Der Agent wertet die Ergebnisse automatisch aus und schlägt Verbesserungen vor (z. B. MTU-Optimierung, Intervall-Anpassung).
          </div>
        </div>
      </div>

      {/* Sniffer + Fehlersimulation */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <RadioTower className="w-3.5 h-3.5 text-rose-300" /> Paket-Sniffer (Low-Level)
          </h4>
          <div className="flex flex-wrap gap-2 mb-3">
            {/* Echter Frame-Capture des Host-ATT-Stapels */}
            <button
              onClick={fetchHostSniffer}
              disabled={sniffBusy}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-rose-600 to-red-700 text-white hover:brightness-110 transition disabled:opacity-40"
            >
              {sniffBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              Host-ATT-Frames abrufen
            </button>
            {/* Lokaler Sniffer (Offline-Fallback) */}
            <button
              onClick={() => run(() => store.toggleSniffer())}
              className={`flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg border transition ${
                store.snifferActive
                  ? 'bg-rose-600 text-white border-rose-500/50'
                  : 'bg-slate-800 text-slate-200 border-white/10 hover:bg-slate-700'
              }`}
            >
              <Activity className={`w-3 h-3 ${store.snifferActive ? 'animate-pulse' : ''}`} />
              {store.snifferActive ? 'Lokal stoppen' : 'Lokaler Fallback'}
            </button>
          </div>
          {hostOnline && hostFrames.length > 0 && (
            <div className="mb-2 text-[9px] font-mono text-emerald-300">
              ● Echte ATT-Frames vom Host ({hostFrames.length}) – protokollkorrekter Stapel
            </div>
          )}
          <div className="max-h-40 overflow-y-auto space-y-0.5 font-mono text-[9px]">
            {hostOnline && hostFrames.length > 0 && (
              hostFrames.slice().reverse().map((f, i) => (
                <div key={i} className={`flex gap-1.5 px-2 py-0.5 rounded ${f.dir === 'rx' ? 'text-emerald-300/80' : 'text-cyan-300/80'} bg-slate-900/40`}>
                  <span className="text-slate-600">{f.time}</span>
                  <span>{f.dir === 'rx' ? '←' : '→'}</span>
                  <span className="text-slate-400">{f.deviceId}</span>
                  <span className="text-rose-300">0x{f.opcode.toString(16).padStart(2, '0')}</span>
                  <span className="truncate">{f.hex}</span>
                </div>
              ))
            )}
            {(!hostOnline || hostFrames.length === 0) && store.snifferPackets.slice(-15).reverse().map((p) => (
              <div key={p.id} className={`flex gap-1.5 px-2 py-0.5 rounded ${p.dir === 'rx' ? 'text-emerald-300/80' : 'text-cyan-300/80'} ${p.adv === 'FAULT' ? 'bg-rose-950/40 text-rose-300' : 'bg-slate-900/40'}`}>
                <span className="text-slate-600">{p.time}</span>
                <span>{p.dir === 'rx' ? '←' : '→'}</span>
                <span className="text-slate-400">{p.addr}</span>
                <span>{p.adv}</span>
                <span className="truncate">{p.data}</span>
              </div>
            ))}
            {store.snifferPackets.length === 0 && (!hostOnline || hostFrames.length === 0) && (
              <div className="text-slate-600 text-center py-4">
                Keine Frames – „Host-ATT-Frames abrufen“ (echte Transaktionen) oder lokalen Sniffer starten.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
          <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
            <Bug className="w-3.5 h-3.5 text-amber-300" /> Fehlersimulation
            <Chip className="text-amber-300 border-amber-600/40 bg-amber-950/40">Developer L3 · WebAuthn</Chip>
          </h4>
          <div className="flex gap-2 mb-2">
            <select
              value={faultDevId}
              onChange={(e) => setFaultDevId(e.target.value)}
              className="flex-1 bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900"
            >
              {store.devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FAULTS.map((f) => (
              <button
                key={f.kind}
                onClick={() => run(() => store.injectFault(f.kind, faultDevId))}
                className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-900/40 hover:bg-amber-800/50 text-amber-100 border border-amber-700/40 transition"
              >
                <Zap className="w-3 h-3 inline mr-1" />{f.label}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[9px] font-mono text-slate-600">
            Der Agent prüft vor jeder Injektion die Auswirkungen auf das Zielgerät und protokolliert den Eingriff im Audit-Log.
          </div>
        </div>
      </div>

      {feedback && (
        <div className="text-[10px] font-mono text-emerald-200 bg-emerald-950/30 border border-emerald-800/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
          {feedback}
        </div>
      )}
    </div>
  );
}
