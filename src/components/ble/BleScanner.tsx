/**
 * 2.1 Erweiterte Geräteerkennung & -analyse.
 * Kontinuierlicher BLE-Scan, automatische Klassifizierung, RSSI-Live-Monitoring,
 * Filter (Name/Hersteller/UUID/Stärke/Klasse) und Agenten-Vorschläge.
 */
import { useMemo, useState } from 'react';
import {
  Bluetooth, Play, Square, Search, Filter, RadioTower, Cpu, BatteryFull, BatteryMedium, BatteryLow,
  Plug, Unplug, Loader,
} from 'lucide-react';
import { useBleStore } from './useBleStore';
import { RssiHistoryChart, Chip, StatCard } from './BleCharts';
import { useLiveBle } from '../../hooks/useLiveBle';
import { WebBluetoothService } from '../../lib/ble/webBluetooth';
import NfcReader from '../NfcReader';
import { DEVICE_CLASS_COLORS, DEVICE_CLASS_LABELS, BleDeviceClass } from '../../lib/ble/types';

const CLASS_FILTERS: Array<BleDeviceClass | 'all'> = ['all', 'ntag', 'token', 'mesh', 'peripheral'];

function BatteryIcon({ level }: { level?: number }) {
  if (level === undefined) return <span className="text-slate-600">--</span>;
  if (level > 60) return <span className="flex items-center gap-1 text-emerald-300"><BatteryFull className="w-3.5 h-3.5" />{level}%</span>;
  if (level > 30) return <span className="flex items-center gap-1 text-amber-300"><BatteryMedium className="w-3.5 h-3.5" />{level}%</span>;
  return <span className="flex items-center gap-1 text-rose-300"><BatteryLow className="w-3.5 h-3.5" />{level}%</span>;
}

export default function BleScanner() {
  const store = useBleStore();
  const { device: liveDevice, supported: liveSupported } = useLiveBle();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cls, setCls] = useState<BleDeviceClass | 'all'>('all');
  const [minRssi, setMinRssi] = useState<number | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const connectLive = async () => {
    setLiveBusy(true);
    setLiveError(null);
    try {
      const device = await WebBluetoothService.connectAndDiscover();
      // Echtes Gerät auch im Store registrieren (Agent/Übersicht sehen es)
      store.setLiveDevice({
        id: device.id,
        name: device.name,
        rssi: device.rssi,
        services: device.services.map((s) => ({
          uuid: s.uuid,
          name: s.name,
          characteristics: s.characteristics.map((c) => ({
            uuid: c.uuid,
            name: c.name,
            properties: c.properties,
          })),
        })),
      });
    } catch (e) {
      setLiveError(String(e));
    } finally {
      setLiveBusy(false);
    }
  };

  const disconnectLive = async () => {
    await WebBluetoothService.disconnect();
    store.setLiveDevice(null);
  };

  const devices = useMemo(
    () => store.filterDevices({ query, cls, minRssi }),
    [store, query, cls, minRssi],
  );
  const selected = store.devices.find((d) => d.id === selectedId) ?? null;
  const stats = store.stats();

  const countByClass = (c: BleDeviceClass | 'all') =>
    c === 'all' ? store.deviceCount() : store.devices.filter((d) => d.deviceClass === c).length;

  return (
    <div className="space-y-4">
      {/* Kopfzeile: Scan-Steuerung + Dongle */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => (store.scanRunning ? store.stopScan() : store.startScan())}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold shadow-lg transition ${
              store.scanRunning
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-gradient-to-br from-cyan-600 to-blue-700 hover:brightness-110 text-white'
            }`}
          >
            {store.scanRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {store.scanRunning ? 'Scan stoppen' : 'BLE-Scan starten'}
          </button>
          <span className={`flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-xl border ${store.scanRunning ? 'bg-emerald-950/50 border-emerald-700/40 text-emerald-200 animate-pulse' : 'bg-slate-900/60 border-white/5 text-slate-400'}`}>
            <RadioTower className="w-3.5 h-3.5" /> {store.scanRunning ? 'Scan aktiv (Bluetooth 4.2/5.x)' : 'Scan inaktiv'}
          </span>
          <span className="flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-xl border border-white/5 bg-slate-900/60 text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-violet-300" /> {store.dongle.name} <span className="text-slate-500">{store.dongle.vid}:{store.dongle.pid}</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 min-w-[220px]">
          <StatCard label="Geräte" value={String(stats.devices)} accent="text-cyan-200" />
          <StatCard label="Verbunden" value={`${stats.connected}/20`} accent="text-emerald-200" />
          <StatCard label="Mesh-Knoten" value={String(stats.meshNodes)} accent="text-amber-200" />
        </div>
      </div>

      {/* Live-Gerät (echte Hardware via Web Bluetooth) */}
      <div className={`rounded-2xl border p-4 ${liveDevice ? 'border-emerald-500/40 bg-emerald-950/20' : 'border-white/5 bg-[#060f2a]/60'}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs font-black text-white flex items-center gap-2">
            <Bluetooth className="w-3.5 h-3.5 text-emerald-300" /> Live-Gerät (Web Bluetooth)
            {liveSupported
              ? <span className="text-[9px] font-bold text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-1.5 py-0.5 rounded-full">echte Hardware</span>
              : <span className="text-[9px] font-bold text-amber-300 border border-amber-700/40 bg-amber-950/40 px-1.5 py-0.5 rounded-full">Browser ohne Web-Bluetooth</span>}
          </h4>
          {liveDevice ? (
            <button
              onClick={disconnectLive}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition"
            >
              <Unplug className="w-3 h-3" /> Live-Gerät trennen
            </button>
          ) : (
            <button
              onClick={connectLive}
              disabled={!liveSupported || liveBusy}
              className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 text-white hover:brightness-110 transition disabled:opacity-40"
            >
              {liveBusy ? <Loader className="w-3 h-3 animate-spin" /> : <Plug className="w-3 h-3" />}
              Gerät auswählen &amp; verbinden
            </button>
          )}
        </div>
        {liveDevice && (
          <div className="mt-2 grid sm:grid-cols-3 gap-2 text-[10px] font-mono">
            <div className="bg-[#020617] border border-white/5 rounded-lg px-2.5 py-1.5">
              <span className="text-slate-500">Name</span> <b className="text-white ml-1">{liveDevice.name}</b>
            </div>
            <div className="bg-[#020617] border border-white/5 rounded-lg px-2.5 py-1.5">
              <span className="text-slate-500">RSSI</span> <b className={liveDevice.rssi != null && liveDevice.rssi > -75 ? 'text-emerald-300 ml-1' : 'text-slate-300 ml-1'}>{liveDevice.rssi ?? '–'} dBm</b>
            </div>
            <div className="bg-[#020617] border border-white/5 rounded-lg px-2.5 py-1.5">
              <span className="text-slate-500">Services</span> <b className="text-cyan-200 ml-1">{liveDevice.services.length}</b>
            </div>
          </div>
        )}
        {liveError && (
          <div className="mt-2 text-[10px] font-mono text-rose-200 bg-rose-950/30 border border-rose-800/30 rounded-lg px-3 py-2">
            ⚠️ {liveError}
          </div>
        )}
        {!liveSupported && (
          <div className="mt-2 text-[9px] font-mono text-slate-500">
            Web Bluetooth benötigt Chromium/Edge (Windows, macOS, Android, ChromeOS) im sicheren Kontext.
            Ohne Hardware bleibt die untenstehende Simulation als Offline-Fallback aktiv.
          </div>
        )}
      </div>

      {/* Klassifizierungs-Legende */}
      <div className="flex flex-wrap gap-2">
        {CLASS_FILTERS.map((c) => (
          <button
            key={c}
            onClick={() => setCls(c)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition ${
              cls === c
                ? 'border-cyan-400/60 bg-cyan-950/60 text-cyan-100 ring-1 ring-cyan-300/30'
                : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
          >
            {c === 'all' ? `Alle (${countByClass('all')})` : `${DEVICE_CLASS_LABELS[c]} (${countByClass(c)})`}
          </button>
        ))}
      </div>

      {/* Filterleiste */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex items-center gap-2 flex-1 bg-slate-900/70 border border-white/10 rounded-xl px-3">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtern nach Name, Hersteller, MAC oder Service-UUID…"
            className="flex-1 bg-transparent py-2.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none"
          />
        </div>
        <div className="flex items-center gap-2 bg-slate-900/70 border border-white/10 rounded-xl px-3">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={minRssi ?? ''}
            onChange={(e) => setMinRssi(e.target.value === '' ? undefined : Number(e.target.value))}
            className="bg-transparent py-2.5 text-xs text-slate-100 outline-none [&>option]:bg-slate-900"
          >
            <option value="">Signal: alle</option>
            <option value={-60}>nur stark (≥ -60 dBm)</option>
            <option value={-75}>ab -75 dBm</option>
            <option value={-90}>ab -90 dBm</option>
          </select>
        </div>
      </div>

      {/* Geräteliste */}
      <div className="grid md:grid-cols-2 gap-3">
        {devices.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
            className={`text-left rounded-2xl border p-4 transition-all ${
              selectedId === d.id
                ? 'bg-[#0a1835]/90 border-cyan-400/50 ring-1 ring-cyan-300/20 scale-[1.01]'
                : 'bg-[#060f2a]/60 border-white/5 hover:border-white/15'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bluetooth className={`w-3.5 h-3.5 shrink-0 ${d.connected ? 'text-emerald-300' : 'text-slate-500'}`} />
                  <span className="text-sm font-black text-white truncate">{d.name}</span>
                  {d.connected && <span className="text-[9px] font-black text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-1.5 py-0.5 rounded-full">VERBUNDEN</span>}
                  {d.bound && <span className="text-[9px] font-black text-blue-300 border border-blue-700/40 bg-blue-950/40 px-1.5 py-0.5 rounded-full">GEBUNDEN</span>}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">{d.address} · {d.manufacturer}</div>
              </div>
              <Chip className={DEVICE_CLASS_COLORS[d.deviceClass]}>{DEVICE_CLASS_LABELS[d.deviceClass]}</Chip>
            </div>

            <div className="mt-2 flex items-center gap-3 text-[11px] font-mono">
              <span className={d.rssi > -60 ? 'text-emerald-300' : d.rssi > -75 ? 'text-amber-300' : 'text-rose-300'}>
                RSSI {d.rssi} dBm
              </span>
              <span className="text-slate-500">Tx {d.txPower} dBm</span>
              <BatteryIcon level={d.battery} />
              {d.provisioned !== undefined && (
                <span className={`text-slate-500 ${d.provisioned ? 'text-amber-300' : ''}`}>
                  {d.provisioned ? 'provisioniert' : 'nicht provisioniert'}
                </span>
              )}
            </div>

            <div className="mt-1">
              <RssiHistoryChart history={d.rssiHistory} color={d.connected ? '#34d399' : '#22d3ee'} />
            </div>
          </button>
        ))}
        {devices.length === 0 && (
          <div className="md:col-span-2 text-center py-10 text-slate-500 text-xs">
            Keine Geräte gefunden – Filter anpassen oder Scan starten.
          </div>
        )}
      </div>

      {/* NTag/NFC-NDEF-Lesen (echte WebNFC-Hardware, wenn verfügbar) */}
      <NfcReader
        onTagRead={(res) => {
          // Erkannten NDEF-Text ins Filterfeld übernehmen (NFC↔BLE-Workflow)
          if (res.message && res.message !== '(kein Text-NDEF)') {
            setQuery(res.message.slice(0, 60));
          }
        }}
      />

      {/* Agenten-Vorschlag für ausgewähltes Gerät */}
      {selected && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-4">
          <div className="text-xs font-black text-violet-200 mb-2 flex items-center gap-2">
            🤖 Agenten-Bewertung für {selected.name}
          </div>
          <div className="text-[11px] font-mono text-slate-300 space-y-1">
            <div>• Klasse: <b className="text-violet-300">{DEVICE_CLASS_LABELS[selected.deviceClass]}</b> (automatisch klassifiziert)</div>
            <div>• Vorschlag: <b className="text-cyan-200">
              {selected.deviceClass === 'ntag' && 'Profil „NTag Batterieüberwachung (Standard)“ – Kompatibilität geprüft (Service UUID FEA9 vorhanden).'}
              {selected.deviceClass === 'token' && 'Profil „BLE-Token Telemetrie 10s“ – Sensor-/Aktor-Test empfohlen.'}
              {selected.deviceClass === 'mesh' && (selected.provisioned ? 'Bestehendem Mesh-Netzwerk zuordnen oder Routing prüfen.' : 'Als Mesh-Knoten provisionieren (Rolle: Relay/Proxy).')}
              {selected.deviceClass === 'peripheral' && 'Keine Standard-Konfiguration – manuelle GATT-Analyse empfohlen.'}
            </b></div>
            <div className="pt-1 text-slate-500">
              Frag den Agenten im Chat: „Konfiguriere {selected.name}…“ oder „Erstelle ein Mesh-Netzwerk…“
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
