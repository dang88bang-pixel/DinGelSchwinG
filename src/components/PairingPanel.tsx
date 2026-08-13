import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Bluetooth, Waves, Wifi, ShieldCheck, Smartphone, Zap, AlertTriangle } from 'lucide-react';

export interface PairedDevice {
  id: string;
  name: string;
  method: 'qr' | 'ble' | 'nfc' | 'wifi';
  rssi: number | null;
  txPower?: number | null;
  boundAt: string;
  payload?: unknown;
}

function parseQrPayload(decodedText: string): Pick<PairedDevice, 'id' | 'name' | 'rssi' | 'txPower' | 'payload'> {
  try {
    const data = JSON.parse(decodedText) as Record<string, unknown>;
    const id = String(data.id || data.deviceId || data.serial || decodedText);
    const name = String(data.name || data.label || id);
    const rssi = typeof data.rssi === 'number' ? data.rssi : null;
    const txPower = typeof data.txPower === 'number' ? data.txPower : null;
    return { id, name, rssi, txPower, payload: data };
  } catch {
    const clean = decodedText.trim();
    return { id: clean, name: clean.slice(0, 32) || 'QR-Gerät', rssi: null, txPower: null, payload: decodedText };
  }
}

export default function PairingPanel({ onBind, boundDevices = [] }: { onBind: (device: PairedDevice) => void; boundDevices?: PairedDevice[] }) {
  const [scanningQR, setScanningQR] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [pairingMethod, setPairingMethod] = useState<'qr' | 'ble' | 'nfc' | 'wifi'>('qr');
  const [statusMsg, setStatusMsg] = useState('Bereit zur Kopplung');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (scannerRef.current) scannerRef.current.clear().catch(() => {});
    };
  }, []);

  const bindDevice = useCallback((device: PairedDevice) => {
    onBind(device);
    setStatusMsg('Kopplung erfolgreich — Gerät gebunden');
    setErrorMsg(null);
  }, [onBind]);

  const startQR = useCallback(() => {
    if (scanningQR) return;
    setPairingMethod('qr');
    setScanningQR(true);
    setScanResult(null);
    setErrorMsg(null);
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
            const parsed = parseQrPayload(decodedText);
            const device: PairedDevice = {
              ...parsed,
              method: 'qr',
              boundAt: new Date().toISOString(),
            };
            setScanResult(decodedText);
            bindDevice(device);
            setScanningQR(false);
            scanner.clear().catch(() => {});
            scannerRef.current = null;
          },
          () => {
            // Scanner emits frequent decode misses; they are not actionable errors.
          },
        );
      } catch (e) {
        setScanningQR(false);
        setErrorMsg(e instanceof Error ? e.message : 'Kamera konnte nicht gestartet werden');
      }
    }, 0);
  }, [bindDevice, scanningQR]);

  const bindBLE = useCallback(async () => {
    setPairingMethod('ble');
    setErrorMsg(null);
    setStatusMsg('BLE-Geräteauswahl öffnen');
    try {
      const bluetooth = (navigator as any).bluetooth;
      if (!bluetooth?.requestDevice) throw new Error('Web Bluetooth wird in diesem Browser/WebView nicht unterstützt.');
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information'],
      });
      bindDevice({
        id: device.id,
        name: device.name || device.id,
        method: 'ble',
        rssi: null,
        txPower: -59,
        boundAt: new Date().toISOString(),
        payload: { id: device.id, name: device.name },
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'BLE-Kopplung fehlgeschlagen');
      setStatusMsg('BLE-Kopplung nicht abgeschlossen');
    }
  }, [bindDevice]);

  const bindNFC = useCallback(async () => {
    setPairingMethod('nfc');
    setErrorMsg(null);
    setStatusMsg('NFC-Token lesen — Tag ans Gerät halten');
    try {
      const NDEFReaderCtor = (window as any).NDEFReader;
      if (!NDEFReaderCtor) throw new Error('Web NFC wird in diesem Browser/WebView nicht unterstützt.');
      const reader = new NDEFReaderCtor();
      await reader.scan();
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('NFC-Lesevorgang ohne Tag abgelaufen.')), 15000);
        reader.onreading = (event: any) => {
          window.clearTimeout(timeout);
          const records = Array.from(event.message?.records || []).map((record: any) => ({ recordType: record.recordType, mediaType: record.mediaType }));
          bindDevice({
            id: event.serialNumber || `nfc-${new Date().toISOString()}`,
            name: event.serialNumber ? `NFC ${event.serialNumber}` : 'NFC-Tag',
            method: 'nfc',
            rssi: null,
            txPower: null,
            boundAt: new Date().toISOString(),
            payload: { serialNumber: event.serialNumber, records },
          });
          resolve();
        };
        reader.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error('NFC-Tag konnte nicht gelesen werden.'));
        };
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'NFC-Kopplung fehlgeschlagen');
      setStatusMsg('NFC-Kopplung nicht abgeschlossen');
    }
  }, [bindDevice]);

  const bindWiFi = useCallback(() => {
    setPairingMethod('wifi');
    setErrorMsg(null);
    try {
      const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (!connection) throw new Error('Network Information API wird in diesem Browser/WebView nicht unterstützt.');
      const name = `${connection.effectiveType || connection.type || 'network'}${connection.downlink ? ` ${connection.downlink}Mbps` : ''}`;
      bindDevice({
        id: `wifi-${connection.type || 'connection'}-${connection.effectiveType || 'unknown'}`,
        name,
        method: 'wifi',
        rssi: null,
        txPower: null,
        boundAt: new Date().toISOString(),
        payload: {
          type: connection.type,
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          rtt: connection.rtt,
          saveData: connection.saveData,
        },
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'WiFi-Kopplung fehlgeschlagen');
      setStatusMsg('WiFi-Verbindung konnte nicht aus Browserdaten gelesen werden');
    }
  }, [bindDevice]);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="bg-gradient-to-br from-slate-900/80 to-blue-950/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 shadow-2xl shadow-blue-900/10">
        <h2 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400 flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-amber-300" /> Client-Kopplung
        </h2>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={startQR} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'qr' ? 'bg-cyan-600 text-white shadow-cyan-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <QrCode className="w-4 h-4" /> QR Code
          </button>
          <button onClick={bindBLE} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'ble' ? 'bg-emerald-600 text-white shadow-emerald-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Bluetooth className="w-4 h-4" /> BLE
          </button>
          <button onClick={bindNFC} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'nfc' ? 'bg-violet-600 text-white shadow-violet-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Waves className="w-4 h-4" /> NFC Token
          </button>
          <button onClick={bindWiFi} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'wifi' ? 'bg-rose-600 text-white shadow-rose-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Wifi className="w-4 h-4" /> WiFi
          </button>
        </div>

        <div className={`text-xs font-mono mb-2 rounded-lg px-3 py-2 border ${pairingMethod === 'qr' ? 'bg-cyan-950/40 border-cyan-700/40 text-cyan-200' : pairingMethod === 'ble' ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-200' : pairingMethod === 'nfc' ? 'bg-violet-950/40 border-violet-700/40 text-violet-200' : 'bg-rose-950/40 border-rose-700/40 text-rose-200'}`}>
          {statusMsg}
        </div>

        {errorMsg && (
          <div className="bg-rose-950/50 border border-rose-600/40 rounded-xl px-3 py-2 text-xs text-rose-200 font-mono mb-2 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {errorMsg}
          </div>
        )}

        {scanningQR && (
          <div className="relative rounded-xl overflow-hidden border border-cyan-500/40 shadow-inner shadow-cyan-900/20 bg-black" id="qr-reader" style={{ minHeight: 240 }}>
            <button onClick={() => { setScanningQR(false); scannerRef.current?.clear().catch(() => {}); scannerRef.current = null; }} className="absolute top-2 right-2 z-10 bg-slate-900/80 text-white text-xs px-2 py-1 rounded-md hover:bg-slate-800">Abbrechen</button>
          </div>
        )}

        {scanResult && !scanningQR && (
          <div className="bg-emerald-950/50 border border-emerald-600/40 rounded-xl px-3 py-2 text-xs text-emerald-200 font-mono mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> QR gebunden: {scanResult.slice(0, 80)}
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-slate-900/60 to-blue-950/40 backdrop-blur-xl border border-slate-700/40 rounded-2xl p-4 flex-1 overflow-y-auto shadow-xl shadow-blue-900/5">
        <h3 className="text-sm font-bold text-slate-200 mb-2 flex items-center gap-2"><Smartphone className="w-4 h-4 text-amber-300" /> Gebundene Clients</h3>
        <div className="flex flex-col gap-2" id="bound-list">
          {boundDevices.length === 0 ? (
            <div className="text-xs text-slate-500 italic">Warte auf echte Kopplung…</div>
          ) : boundDevices.map((device) => (
            <div key={device.id} className="rounded-xl border border-emerald-700/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-100 font-mono">
              <div className="font-bold truncate">{device.name}</div>
              <div className="text-[10px] text-emerald-300">{device.method.toUpperCase()} · {new Date(device.boundAt).toLocaleTimeString('de-DE')}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
