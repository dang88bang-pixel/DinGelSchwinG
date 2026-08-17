import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Bluetooth, Waves, Wifi, ShieldCheck, Smartphone, Zap } from 'lucide-react';
import {
  fromQrPayload,
  requestBluetoothDevice,
  requestUsbDevice,
  readNfcTag,
} from '../lib/devices/browserDiscovery';
import { registry, type ManagedDevice } from '../lib/devices/registry';

export interface PairedDevice {
  id: string;
  name: string;
  method: 'qr' | 'ble' | 'nfc' | 'wifi';
  rssi: number;
  boundAt: string;
}

export default function PairingPanel({ onBind }: { onBind: (device: PairedDevice) => void }) {
  const [scanningQR, setScanningQR] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [pairingMethod, setPairingMethod] = useState<'qr' | 'ble' | 'nfc' | 'wifi'>('qr');
  const [statusMsg, setStatusMsg] = useState('Bereit zur Kopplung');
  const [bound, setBound] = useState<ManagedDevice[]>([]);

  useEffect(() => registry.subscribe((list) => {
    setBound(list.filter((d) => d.bound && d.type !== 'master'));
  }), []);

  useEffect(() => {
    if (!scanningQR) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    }
  }, [scanningQR]);

  const emit = useCallback(async (device: ManagedDevice, method: PairedDevice['method']) => {
    const stored = await registry.bind({ ...device, method, bound: true });
    onBind({
      id: stored.id,
      name: stored.name,
      method,
      rssi: stored.rssi,
      boundAt: new Date().toISOString(),
    });
    setStatusMsg(`Kopplung erfolgreich — ${stored.name}`);
  }, [onBind]);

  const startQR = useCallback(() => {
    if (scanningQR) return;
    setScanningQR(true);
    setScanResult(null);
    setStatusMsg('QR-Scan aktiv — Kamera freigeben');
    window.setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner('qr-reader', {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        }, false);
        scannerRef.current = scanner;
        scanner.render(
          (decodedText: string) => {
            setScanResult(decodedText);
            setStatusMsg('QR erkannt — Gerät wird gebunden');
            void emit(fromQrPayload(decodedText), 'qr');
            setScanningQR(false);
            if (scannerRef.current) {
              scannerRef.current.clear().catch(() => {});
              scannerRef.current = null;
            }
          },
          () => { /* scan frame miss */ },
        );
      } catch {
        setStatusMsg('Kamera-Fehler — bitte Berechtigung prüfen');
      }
    }, 300);
  }, [emit, scanningQR]);

  const bindBle = async () => {
    setPairingMethod('ble');
    setStatusMsg('BLE: Geräteauswahl des Browsers öffnen…');
    try {
      await emit(await requestBluetoothDevice(), 'ble');
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'BLE-Kopplung abgebrochen');
    }
  };

  const bindNfc = async () => {
    setPairingMethod('nfc');
    setStatusMsg('NFC: Tag an das Gerät halten…');
    try {
      await emit(await readNfcTag(), 'nfc');
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'NFC nicht verfügbar');
    }
  };

  const bindWifi = async () => {
    setPairingMethod('wifi');
    setStatusMsg('Netzwerk-Discovery über Backend…');
    try {
      const list = await registry.scan(true);
      const net = list.find((d) => d.source === 'network' || d.source === 'wifi' || d.source === 'host');
      if (!net) {
        setStatusMsg('Kein Netzwerkknoten gefunden — Backend erreichbar?');
        return;
      }
      await emit({ ...net, bound: true }, 'wifi');
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'WiFi-Discovery fehlgeschlagen');
    }
  };

  const bindUsb = async () => {
    setStatusMsg('USB: Geräteauswahl öffnen…');
    try {
      const dev = await requestUsbDevice();
      await emit(dev, 'qr');
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'WebUSB nicht verfügbar');
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="bg-gradient-to-br from-slate-900/80 to-blue-950/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 shadow-2xl shadow-blue-900/10">
        <h2 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400 flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-amber-300" /> Client-Kopplung
        </h2>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => { setPairingMethod('qr'); startQR(); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'qr' ? 'bg-cyan-600 text-white shadow-cyan-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <QrCode className="w-4 h-4" /> QR Code
          </button>
          <button onClick={() => void bindBle()} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'ble' ? 'bg-emerald-600 text-white shadow-emerald-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Bluetooth className="w-4 h-4" /> BLE
          </button>
          <button onClick={() => void bindNfc()} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'nfc' ? 'bg-violet-600 text-white shadow-violet-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Waves className="w-4 h-4" /> NFC Token
          </button>
          <button onClick={() => void bindWifi()} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'wifi' ? 'bg-rose-600 text-white shadow-rose-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Wifi className="w-4 h-4" /> WiFi
          </button>
        </div>
        <button onClick={() => void bindUsb()} className="w-full mb-3 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 border border-slate-600 hover:bg-slate-700">
          USB-Gerät wählen (WebUSB)
        </button>

        <div className={`text-xs font-mono mb-2 rounded-lg px-3 py-2 border ${pairingMethod === 'qr' ? 'bg-cyan-950/40 border-cyan-700/40 text-cyan-200' : pairingMethod === 'ble' ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-200' : pairingMethod === 'nfc' ? 'bg-violet-950/40 border-violet-700/40 text-violet-200' : 'bg-rose-950/40 border-rose-700/40 text-rose-200'}`}>
          {statusMsg}
        </div>

        {scanningQR && (
          <div className="relative rounded-xl overflow-hidden border border-cyan-500/40 shadow-inner shadow-cyan-900/20 bg-black" id="qr-reader" style={{ minHeight: 240 }}>
            <button onClick={() => { setScanningQR(false); }} className="absolute top-2 right-2 z-10 bg-slate-900/80 text-white text-xs px-2 py-1 rounded-md hover:bg-slate-800">Abbrechen</button>
          </div>
        )}

        {scanResult && !scanningQR && (
          <div className="bg-emerald-950/50 border border-emerald-600/40 rounded-xl px-3 py-2 text-xs text-emerald-200 font-mono mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Gebunden: {scanResult}
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-slate-900/60 to-blue-950/40 backdrop-blur-xl border border-slate-700/40 rounded-2xl p-4 flex-1 overflow-y-auto shadow-xl shadow-blue-900/5">
        <h3 className="text-sm font-bold text-slate-200 mb-2 flex items-center gap-2"><Smartphone className="w-4 h-4 text-amber-300" /> Gebundene Clients</h3>
        <div className="flex flex-col gap-2">
          {bound.length === 0 ? (
            <div className="text-xs text-slate-500 italic">Noch keine Kopplung.</div>
          ) : bound.map((c) => (
            <div key={c.id} className="flex items-center gap-2 bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-3 py-2 text-emerald-100 text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <div className="flex-1 truncate font-bold">{c.name}</div>
              <div className="text-[10px] text-emerald-300 font-extrabold">{(c.method || c.source || '').toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
