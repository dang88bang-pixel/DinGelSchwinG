/**
 * 2.2 Geräte-Konfigurationsmanager: zentrale Profile im Cache der Agent Console.
 * Profile speichern, auf kompatible Geräte anwenden (Kompatibilitätsprüfung,
 * kritische Aktionen → WebAuthn), löschen.
 */
import { useState } from 'react';
import { Save, Trash2, CheckCircle2 } from 'lucide-react';
import { useBleStore } from './useBleStore';
import { Chip } from './BleCharts';
import { BleDeviceClass, DEVICE_CLASS_COLORS, DEVICE_CLASS_LABELS, ConfigStepType } from '../../lib/ble/types';

const STEP_LABELS: Record<ConfigStepType, string> = {
  gatt_write: 'GATT-Write',
  gatt_read: 'GATT-Read',
  notify_on: 'Notifications',
  mtu: 'MTU',
  pair: 'Pairing',
  mesh_pub: 'Mesh-Pub',
  mesh_sub: 'Mesh-Sub',
  mesh_model: 'Mesh-Modell',
  ttl: 'TTL',
  verify: 'Verifikation',
};

export default function ProfilesPanel() {
  const store = useBleStore();
  const [name, setName] = useState('');
  const [cls, setCls] = useState<BleDeviceClass>('ntag');
  const [feedback, setFeedback] = useState<string | null>(null);

  const run = (fn: () => string) => setFeedback(fn());

  const saveQuickProfile = () => {
    const steps = cls === 'ntag'
      ? [
          { type: 'gatt_read' as const, target: 'Battery Level', detail: 'Batteriestand lesen' },
          { type: 'gatt_write' as const, target: 'Battery Monitoring (Zustand)', detail: 'Überwachungsmodus aktivieren', value: 'BEEF' },
          { type: 'notify_on' as const, target: 'Battery Monitoring (Zustand)', detail: 'Notifications aktivieren' },
          { type: 'verify' as const, target: 'NTag-Tracker', detail: 'Funktionsprüfung' },
        ]
      : [
          { type: 'gatt_read' as const, target: 'Battery Level', detail: 'Batteriestand lesen' },
          { type: 'gatt_write' as const, target: 'Report', detail: 'Telemetrie-Intervall setzen', value: '0A' },
          { type: 'verify' as const, target: 'BLE-Token', detail: '3 Samples auswerten' },
        ];
    const n = name.trim() || (cls === 'ntag' ? 'Neues NTag-Profil' : 'Neues Token-Profil');
    run(() => store.saveProfile(n, cls, steps));
    setName('');
  };

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      {/* Neues Profil */}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4 h-fit">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <Save className="w-3.5 h-3.5 text-cyan-300" /> Profil speichern
        </h4>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Profilname…"
          className="w-full mb-2 bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-400/50"
        />
        <select
          value={cls}
          onChange={(e) => setCls(e.target.value as BleDeviceClass)}
          className="w-full mb-3 bg-slate-900/70 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-slate-100 outline-none [&>option]:bg-slate-900"
        >
          {(Object.keys(DEVICE_CLASS_LABELS) as BleDeviceClass[]).map((c) => (
            <option key={c} value={c}>{DEVICE_CLASS_LABELS[c]}</option>
          ))}
        </select>
        <button
          onClick={saveQuickProfile}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] font-extrabold px-3 py-2.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:brightness-110 transition"
        >
          <Save className="w-3 h-3" /> Standard-Ablauf als Profil speichern
        </button>
        <div className="mt-3 text-[9px] font-mono text-slate-600 leading-relaxed">
          Profile werden im zentralen Profil-Cache der Agent Console gespeichert und können per Chat
          abgerufen, angepasst und auf beliebige kompatible Geräte angewendet werden.
        </div>
      </div>

      {/* Profil-Cache */}
      <div className="space-y-3">
        {store.profiles.map((p) => (
          <div key={p.id} className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-black text-white">{p.name}</span>
                <Chip className={DEVICE_CLASS_COLORS[p.deviceClass]}>{DEVICE_CLASS_LABELS[p.deviceClass]}</Chip>
                <span className="text-[9px] font-mono text-slate-500">erstellt {new Date(p.createdAt).toLocaleDateString('de-DE')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  onChange={(e) => {
                    if (e.target.value) run(() => store.applyProfile(p.id, e.target.value));
                  }}
                  value=""
                  className="bg-slate-900/70 border border-white/10 rounded-lg px-2.5 py-1.5 text-[10px] text-slate-100 outline-none [&>option]:bg-slate-900"
                >
                  <option value="">Auf Gerät anwenden…</option>
                  {store.devices.filter((d) => d.deviceClass === p.deviceClass).map((d) => (
                    <option key={d.id} value={d.id}>{d.name} ({d.rssi} dBm)</option>
                  ))}
                </select>
                <button
                  onClick={() => run(() => store.deleteProfile(p.id))}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-300 transition"
                  title="Profil löschen"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {p.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-slate-300">
                  <span className="w-4 text-slate-600 text-right">{i + 1}.</span>
                  <Chip className="text-slate-300 border-slate-600/40 bg-slate-900/60">{STEP_LABELS[s.type]}</Chip>
                  <span className="truncate">{s.detail}</span>
                  {s.value && <span className="text-cyan-200 whitespace-nowrap">0x{s.value}</span>}
                  {s.critical && <span className="text-rose-300">⚠️</span>}
                </div>
              ))}
            </div>
            {p.steps.some((s) => s.critical) && (
              <div className="mt-2 text-[9px] font-mono text-rose-300 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Anwendung überschreibt Gerätekonfiguration → WebAuthn erforderlich
              </div>
            )}
          </div>
        ))}
        {store.profiles.length === 0 && (
          <div className="text-center py-10 text-slate-500 text-xs">
            Noch keine Profile im Cache.
          </div>
        )}
        {feedback && (
          <div className="text-[10px] font-mono text-cyan-200 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {feedback}
          </div>
        )}
      </div>
    </div>
  );
}
