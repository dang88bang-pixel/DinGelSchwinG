/**
 * DiscoveryDashboard – Geräte-Discovery & Binding (echte Host-Geräte).
 * Lädt gescannte Geräte vom Host (/api/ble/scan + /api/ble/virtual), zeigt
 * sie als Kacheln mit Live-RSSI und bietet Bind-/Connect-Buttons.
 * Auto-Refresh 5 s; importiert in den SuiteStore (Agent/GATT sehen die Geräte).
 */
import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, Plug, Unplug, RefreshCw, Loader2, RadioTower, Server } from 'lucide-react';
import { useBleStore } from './useBleStore';
import { api, isHostReachable, VirtualPeripheral } from '../../lib/api/client';
import { Chip } from './BleCharts';
import { DEVICE_CLASS_COLORS, DEVICE_CLASS_LABELS, BleDeviceClass } from '../../lib/ble/types';

interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
  deviceClass: string;
  backend: string;
  connected: boolean;
  bound: boolean;
}

export default function DiscoveryDashboard() {
  const store = useBleStore();
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [hostOnline, setHostOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ok = await api.ensureHost();
    setHostOnline(ok);
    if (!ok) return;
    try {
      // Echten Host-Scan ausführen (protokollkorrekter Stapel)
      const scan = await api.bleScan('start', 3);
      const scanDevices = (scan.devices ?? []) as Array<{
        id: string; name: string; address?: string; rssi?: number; deviceClass?: string; backend?: string;
      }>;
      // Virtuelle Peripherals (echte GATT-Server)
      let virtual: VirtualPeripheral[] = [];
      try { virtual = await api.virtualList(); } catch { virtual = []; }

      const merged: DiscoveredDevice[] = [];
      const seen = new Set<string>();
      for (const v of virtual) {
        seen.add(v.id);
        merged.push({
          id: v.id, name: v.name, address: `02:00:00:${v.id.slice(-4)}`,
          rssi: v.rssi, deviceClass: clsOfUuids(v.serviceUuids), backend: 'virtual',
          connected: store.devices.find((d) => d.id === v.id)?.connected ?? false,
          bound: store.devices.find((d) => d.id === v.id)?.bound ?? false,
        });
      }
      for (const d of scanDevices) {
        if (seen.has(d.id)) continue;
        merged.push({
          id: d.id, name: d.name, address: d.address ?? d.id, rssi: d.rssi ?? -70,
          deviceClass: d.deviceClass ?? 'peripheral', backend: d.backend ?? 'host',
          connected: store.devices.find((x) => x.id === d.id)?.connected ?? false,
          bound: store.devices.find((x) => x.id === d.id)?.bound ?? false,
        });
      }
      merged.sort((a, b) => a.rssi - b.rssi);
      setDevices(merged);
      // In den SuiteStore importieren (Agent/GATT sehen die Geräte)
      store.importHostDevices(merged.map((d) => ({
        id: d.id, name: d.name, rssi: d.rssi,
        deviceClass: d.deviceClass as BleDeviceClass,
      })));
      setLastScan(new Date().toLocaleTimeString('de-DE'));
    } catch (e) {
      setMsg(`❌ Scan fehlgeschlagen: ${String(e)}`);
    }
  }, [store]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000); // Auto-Refresh
    return () => window.clearInterval(timer);
  }, [refresh]);

  const bindDevice = async (deviceId: string) => {
    setBusy(true);
    try {
      const res = await api.bleConnect(deviceId, 'connect');
      setMsg(res.ok ? `🔗 Gerät verbunden/gebunden (${res.message ?? 'ok'})` : `❌ ${res.error}`);
      await refresh();
    } catch (e) {
      setMsg(`❌ ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const unbindDevice = async (deviceId: string) => {
    await api.bleConnect(deviceId, 'disconnect');
    setMsg('⏹️ Verbindung getrennt');
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-black text-white flex items-center gap-2">
            <RadioTower className="w-4 h-4 text-cyan-300" /> Geräte-Discovery &amp; Binding
          </h4>
          <span className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
            hostOnline ? 'text-emerald-300 border-emerald-700/40 bg-emerald-950/40'
              : 'text-rose-300 border-rose-700/40 bg-rose-950/40'
          }`}>
            <Server className="w-3 h-3" /> Host {hostOnline ? 'online' : 'offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastScan && <span className="text-[10px] font-mono text-slate-500">letzter Scan: {lastScan}</span>}
          <button onClick={() => { refresh(); }} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 text-[11px] font-extrabold transition disabled:opacity-40">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Jetzt scannen
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {devices.map((d) => (
          <div key={d.id}
            className={`rounded-2xl border p-4 transition ${
              d.connected ? 'border-emerald-500/40 bg-emerald-950/20'
                : d.bound ? 'border-blue-500/40 bg-blue-950/20'
                  : 'border-white/5 bg-[#060f2a]/60 hover:border-white/15'
            }`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Bluetooth className={`w-3.5 h-3.5 ${d.connected ? 'text-emerald-300' : 'text-slate-500'}`} />
                  <span className="text-[13px] font-black text-white truncate">{d.name}</span>
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5 truncate">{d.address}</div>
              </div>
              <Chip className={DEVICE_CLASS_COLORS[(d.deviceClass as BleDeviceClass) ?? 'peripheral']}>
                {DEVICE_CLASS_LABELS[(d.deviceClass as BleDeviceClass) ?? 'peripheral']}
              </Chip>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-mono">
              <span className={d.rssi > -60 ? 'text-emerald-300' : d.rssi > -75 ? 'text-amber-300' : 'text-rose-300'}>
                RSSI {d.rssi} dBm
              </span>
              <span className="text-slate-500">· {d.backend}</span>
              {d.connected && <span className="text-emerald-300">· verbunden</span>}
              {d.bound && <span className="text-blue-300">· gebunden</span>}
            </div>
            <div className="mt-3">
              {d.connected ? (
                <button onClick={() => unbindDevice(d.id)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white text-[11px] font-extrabold transition">
                  <Unplug className="w-3 h-3" /> Trennen
                </button>
              ) : (
                <button onClick={() => bindDevice(d.id)} disabled={busy}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white text-[11px] font-extrabold hover:brightness-110 transition disabled:opacity-40">
                  <Plug className="w-3 h-3" /> Binden / Verbinden
                </button>
              )}
            </div>
          </div>
        ))}
        {devices.length === 0 && (
          <div className="md:col-span-2 lg:col-span-3 text-center py-10 text-slate-500 text-xs">
            {hostOnline
              ? 'Keine Geräte erkannt – „Jetzt scannen“ ausführen oder im Simulator-Tab echte GATT-Server erzeugen.'
              : 'Host nicht erreichbar – Start: python3 -m host.main'}
          </div>
        )}
      </div>

      {msg && <div className="text-[11px] font-mono text-cyan-200 bg-cyan-950/30 border border-cyan-800/30 rounded-lg px-3 py-2">{msg}</div>}
    </div>
  );
}

function clsOfUuids(uuids: string[]): string {
  if (uuids.some((u) => u.startsWith('0000fea9'))) return 'ntag';
  if (uuids.some((u) => u.startsWith('00001827'))) return 'mesh';
  if (uuids.some((u) => u.startsWith('0000180f') || u.startsWith('00001812'))) return 'token';
  return 'peripheral';
}
