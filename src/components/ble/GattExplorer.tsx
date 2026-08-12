/**
 * 2.2 Detaillierte Geräteverbindung & agentengesteuerte Konfiguration.
 * Parallele Verbindungen (≤ 20), vollständiger GATT-Explorer mit Lese-/
 * Schreibzugriff (Hex/Dez/Bin/ASCII), Notifications, MTU-Anpassung.
 */
import { useMemo, useState } from 'react';
import {
  Plug, Unplug, Layers, Bell, BellOff, Ruler, ArrowDownToLine, Binary, Hash, Type, AlignLeft,
} from 'lucide-react';
import { useBleStore } from './useBleStore';
import { useLiveBle } from '../../hooks/useLiveBle';
import { WebBluetoothService, hexOf, LiveBleCharacteristic } from '../../lib/ble/webBluetooth';
import { Chip } from './BleCharts';
import { DEVICE_CLASS_LABELS, DEVICE_CLASS_COLORS } from '../../lib/ble/types';

type ValueMode = 'hex' | 'dec' | 'bin' | 'ascii';

function renderValue(hexStr: string, mode: ValueMode): string {
  const bytes = (hexStr.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16));
  if (mode === 'dec') return bytes.join(' ') || '(leer)';
  if (mode === 'bin') return bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ') || '(leer)';
  if (mode === 'ascii') return bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('') || '(leer)';
  return `0x${hexStr || '(leer)'}`;
}

const MODE_ICONS: Record<ValueMode, React.ReactNode> = {
  hex: <Hash className="w-3 h-3" />,
  dec: <Binary className="w-3 h-3" />,
  bin: <Type className="w-3 h-3" />,
  ascii: <AlignLeft className="w-3 h-3" />,
};

// ---------------------------------------------------------------------------
// Live-GATT (echte Hardware via Web Bluetooth) – ersetzt den Simulationspfad,
// sobald ein Live-Gerät verbunden ist.
// ---------------------------------------------------------------------------
function LiveGattPanel({ onClose }: { onClose: () => void }) {
  const { device } = useLiveBle();
  const [valueMode, setValueMode] = useState<ValueMode>('hex');
  const [writeHex, setWriteHex] = useState('');
  const [notifyStream, setNotifyStream] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!device) return null;

  const bytesToText = (bytes: Uint8Array, mode: ValueMode): string => {
    if (mode === 'dec') return Array.from(bytes).join(' ') || '(leer)';
    if (mode === 'bin') return Array.from(bytes).map((b) => b.toString(2).padStart(8, '0')).join(' ') || '(leer)';
    if (mode === 'ascii') return Array.from(bytes).map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('') || '(leer)';
    return `0x${hexOf(bytes) || '(leer)'}`;
  };

  const read = async (ch: LiveBleCharacteristic) => {
    try {
      const bytes = await ch.readValue();
      setFeedback(`📖 ${ch.name} (${ch.uuid})\n${bytesToText(bytes, valueMode)}`);
    } catch (e) {
      setFeedback(`❌ Read fehlgeschlagen: ${String(e)}`);
    }
  };

  const write = async (ch: LiveBleCharacteristic) => {
    const clean = writeHex.replace(/[^0-9a-fA-F]/g, '') || '00';
    const bytes = new Uint8Array(clean.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    try {
      await ch.writeValue(bytes, !ch.properties.includes('write'));
      setFeedback(`✍️ 0x${hexOf(bytes)} geschrieben`);
    } catch (e) {
      setFeedback(`❌ Write fehlgeschlagen: ${String(e)}`);
    }
  };

  const toggleNotify = async (ch: LiveBleCharacteristic, on: boolean) => {
    try {
      if (on) {
        await ch.startNotifications((value) => {
          setNotifyStream((prev) => [...prev.slice(-9), `🔔 ${ch.name}: ${bytesToText(value, valueMode)}`]);
        });
        setFeedback(`🔔 Notifications an (${ch.name})`);
      } else {
        await ch.stopNotifications();
        setFeedback(`🔕 Notifications aus (${ch.name})`);
      }
    } catch (e) {
      setFeedback(`❌ Notify fehlgeschlagen: ${String(e)}`);
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h4 className="text-xs font-black text-emerald-100 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-emerald-300" /> Live-GATT · {device.name}
          <span className="text-[9px] font-mono text-emerald-300/70">{device.id}</span>
          <span className="text-[9px] font-bold text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-1.5 py-0.5 rounded-full">echte Hardware</span>
        </h4>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(Object.keys(MODE_ICONS) as ValueMode[]).map((m) => (
              <button
                key={m}
                title={`Wert-Anzeige: ${m.toUpperCase()}`}
                onClick={() => setValueMode(m)}
                className={`p-1.5 transition ${valueMode === m ? 'bg-emerald-600/60 text-white' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'}`}
              >
                {MODE_ICONS[m]}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-600/80 text-white hover:bg-rose-600 transition"
          >
            <Unplug className="w-3 h-3" /> Trennen
          </button>
        </div>
      </div>

      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {device.services.map((svc) => (
          <div key={svc.uuid} className="rounded-xl border border-white/5 bg-slate-900/50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <span className="text-[11px] font-black text-emerald-200">{svc.name}</span>
              <span className="text-[9px] font-mono text-slate-500">{svc.uuid}</span>
            </div>
            <div className="divide-y divide-white/5">
              {svc.characteristics.map((ch) => (
                <div key={ch.uuid} className="px-3 py-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-[11px] font-bold text-slate-100">{ch.name}</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {ch.properties.map((p) => (
                        <span key={p} className="text-[8px] font-black uppercase tracking-wide text-emerald-300 border border-emerald-500/30 bg-emerald-950/30 rounded px-1.5 py-0.5">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    {ch.properties.includes('read') && (
                      <button onClick={() => read(ch)} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition">
                        Lesen
                      </button>
                    )}
                    {ch.properties.includes('write') && (
                      <div className="flex items-center gap-1">
                        <input
                          value={writeHex}
                          onChange={(e) => setWriteHex(e.target.value)}
                          placeholder="Wert (hex)"
                          className="w-24 bg-slate-900/70 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-slate-100 outline-none focus:border-emerald-400/50"
                        />
                        <button onClick={() => write(ch)} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-100 border border-emerald-700/40 transition">
                          Schreiben
                        </button>
                      </div>
                    )}
                    {ch.properties.includes('notify') && (
                      <button onClick={() => toggleNotify(ch, true)} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-700/60 text-slate-200 border border-white/10 transition">
                        Notify an
                      </button>
                    )}
                    {ch.properties.includes('indicate') && (
                      <span className="text-[9px] font-mono text-slate-500">Indicate-Support</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {notifyStream.length > 0 && (
        <div className="mt-3 space-y-1 font-mono text-[10px] text-emerald-200 bg-[#020617] border border-emerald-900/40 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
          {notifyStream.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      {feedback && (
        <div className="mt-3 text-[10px] font-mono text-cyan-200 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
          {feedback}
        </div>
      )}
    </div>
  );
}

export default function GattExplorer() {
  const store = useBleStore();
  const { device: liveDevice } = useLiveBle();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [valueMode, setValueMode] = useState<ValueMode>('hex');
  const [writeHex, setWriteHex] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const candidates = useMemo(
    () => store.devices.filter((d) => d.connectable),
    [store],
  );
  const device = store.devices.find((d) => d.id === deviceId) ?? null;
  const profile = deviceId ? store.getGatt(deviceId) : null;

  const run = (fn: () => string) => {
    setFeedback(fn());
  };

  return (
    <div>
      {/* Live-GATT (echte Hardware) – erscheint, sobald ein Live-Gerät verbunden ist */}
      {liveDevice && (
        <LiveGattPanel
          onClose={async () => {
            await WebBluetoothService.disconnect();
            store.setLiveDevice(null);
          }}
        />
      )}

      {/* Simulation/Hinweis-Badge */}
      <div className="flex items-center gap-2 mb-3">
        <Chip className={liveDevice ? 'text-emerald-300 border-emerald-600/40 bg-emerald-950/40' : 'text-amber-300 border-amber-600/40 bg-amber-950/40'}>
          {liveDevice ? 'Live-Modus aktiv (echte Hardware)' : 'Simulations-Modus (Web Bluetooth nicht verbunden)'}
        </Chip>
        {!liveDevice && (
          <span className="text-[9px] font-mono text-slate-500">
            Gerät im Scanner-Tab über „Live-Gerät auswählen“ verbinden – dann zeigt dieser Explorer echte GATT-Werte.
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
      {/* Geräteauswahl */}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4 h-fit">
        <h4 className="text-xs font-black text-white mb-3 flex items-center gap-2">
          <Plug className="w-3.5 h-3.5 text-emerald-300" /> Verbindungen ({store.connectedCount()}/20 parallel)
        </h4>
        <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
          {candidates.map((d) => (
            <div
              key={d.id}
              onClick={() => setDeviceId(d.id)}
              className={`cursor-pointer rounded-xl border px-3 py-2 transition ${
                deviceId === d.id
                  ? 'border-emerald-400/50 bg-emerald-950/30'
                  : 'border-white/5 bg-slate-900/40 hover:border-white/15'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-100 truncate">{d.name}</span>
                <Chip className={DEVICE_CLASS_COLORS[d.deviceClass]}>{DEVICE_CLASS_LABELS[d.deviceClass]}</Chip>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] font-mono text-slate-500">{d.address}</span>
                {d.connected ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); run(() => store.disconnect(d.id)); }}
                    className="flex items-center gap-1 text-[9px] font-bold text-rose-300 hover:text-rose-200"
                  >
                    <Unplug className="w-3 h-3" /> Trennen
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); run(() => store.connect(d.id)); }}
                    className="flex items-center gap-1 text-[9px] font-bold text-emerald-300 hover:text-emerald-200"
                  >
                    <Plug className="w-3 h-3" /> Verbinden
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {feedback && (
          <div className="mt-3 text-[10px] font-mono text-cyan-200 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2 whitespace-pre-wrap">
            {feedback}
          </div>
        )}
      </div>

      {/* GATT-Struktur */}
      <div className="rounded-2xl border border-white/5 bg-[#060f2a]/60 p-4">
        {!device ? (
          <div className="text-center py-16 text-slate-500 text-xs">
            <Layers className="w-8 h-8 mx-auto mb-3 text-slate-600" />
            Wähle links ein Gerät aus, um seine GATT-Services zu erkunden.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <h4 className="text-xs font-black text-white flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-cyan-300" /> GATT-Explorer · {device.name}
                <span className="text-[10px] font-mono text-slate-500">{device.address}</span>
              </h4>
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 text-[10px] font-mono text-slate-300 bg-slate-900/60 border border-white/10 rounded-lg px-2 py-1">
                  <Ruler className="w-3 h-3 text-amber-300" /> MTU
                </span>
                <input
                  type="number"
                  min={23}
                  max={517}
                  value={profile?.mtu ?? 23}
                  onChange={(e) => run(() => store.gattSetMtu(device.id, Number(e.target.value)))}
                  className="w-16 bg-slate-900/70 border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono text-amber-200 outline-none focus:border-amber-400/50"
                />
                <div className="flex rounded-lg overflow-hidden border border-white/10">
                  {(Object.keys(MODE_ICONS) as ValueMode[]).map((m) => (
                    <button
                      key={m}
                      title={`Wert-Anzeige: ${m.toUpperCase()}`}
                      onClick={() => setValueMode(m)}
                      className={`p-1.5 transition ${valueMode === m ? 'bg-cyan-600/60 text-white' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'}`}
                    >
                      {MODE_ICONS[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {!device.connected && (
              <div className="mb-3 text-[10px] font-mono text-amber-200 bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2">
                ⚠️ Gerät nicht verbunden – GATT-Werte werden aus dem Profil-Cache angezeigt. Verbinden, um Live-Operationen durchzuführen.
              </div>
            )}

            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {profile?.services.map((svc) => (
                <div key={svc.uuid} className="rounded-xl border border-white/5 bg-slate-900/50">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                    <span className="text-[11px] font-black text-cyan-200">{svc.name}</span>
                    <span className="text-[9px] font-mono text-slate-500">{svc.uuid}</span>
                  </div>
                  <div className="divide-y divide-white/5">
                    {svc.characteristics.map((ch) => (
                      <div key={ch.uuid} className="px-3 py-2.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div>
                            <span className="text-[11px] font-bold text-slate-100">{ch.name}</span>
                            <span className="ml-2 text-[9px] font-mono text-slate-500">{ch.uuid}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {ch.properties.map((p) => (
                              <span key={p} className="text-[8px] font-black uppercase tracking-wide text-violet-300 border border-violet-500/30 bg-violet-950/30 rounded px-1.5 py-0.5">
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <div className="flex-1 min-w-[120px] bg-[#020617] border border-white/5 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-cyan-200 truncate">
                            {renderValue(ch.valueHex, valueMode)}
                          </div>
                          {ch.properties.includes('read') && (
                            <button
                              onClick={() => run(() => store.gattRead(device.id, ch.uuid))}
                              className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition"
                            >
                              Lesen
                            </button>
                          )}
                          {ch.properties.includes('write') && (
                            <div className="flex items-center gap-1">
                              <input
                                value={writeHex}
                                onChange={(e) => setWriteHex(e.target.value)}
                                placeholder="Wert (hex)"
                                className="w-24 bg-slate-900/70 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-mono text-slate-100 outline-none focus:border-emerald-400/50"
                              />
                              <button
                                onClick={() => run(() => store.gattWrite(device.id, ch.uuid, writeHex || '00'))}
                                className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-800/60 hover:bg-emerald-700/60 text-emerald-100 border border-emerald-700/40 transition"
                              >
                                <ArrowDownToLine className="w-3 h-3" /> Schreiben
                              </button>
                            </div>
                          )}
                          {ch.properties.includes('notify') && (
                            <button
                              onClick={() => run(() => store.gattNotify(device.id, ch.uuid, !ch.notify))}
                              className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition ${
                                ch.notify
                                  ? 'bg-amber-600/60 text-amber-100 border-amber-500/50'
                                  : 'bg-slate-800 text-slate-300 border-white/10 hover:bg-slate-700'
                              }`}
                            >
                              {ch.notify ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                              {ch.notify ? 'Notif. an' : 'Notif. aus'}
                            </button>
                          )}
                        </div>
                        {ch.descriptors.length > 0 && (
                          <div className="mt-1.5 text-[9px] font-mono text-slate-600">
                            Descriptoren: {ch.descriptors.map((d) => `${d.name} (${d.uuid})`).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
