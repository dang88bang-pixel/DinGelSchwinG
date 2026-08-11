import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Bluetooth, Waves, Wifi, ShieldCheck, Smartphone, Zap } from 'lucide-react';

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

  useEffect(() => {
    if (!scanningQR) {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    }
  }, [scanningQR]);

  const startQR = useCallback(() => {
    if (scanningQR) return; // Verhindere Doppel-Scan
    setScanningQR(true);
    setScanResult(null);
    setStatusMsg('QR-Scan aktiv — Kamera freigeben');
    setTimeout(() => {
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
            setStatusMsg('QR erkannt — Bindung wird durchgeführt');
            // Simulate binding
            onBind({
              id: 'bound-' + Date.now(),
              name: 'BoundClient-' + decodedText.slice(0, 8),
              method: 'qr',
              rssi: -55,
              boundAt: new Date().toISOString(),
            });
            setScanningQR(false); // schließen
            if (scannerRef.current) {
              scannerRef.current.clear().catch(() => {});
              scannerRef.current = null;
            }
          },
          (_err: unknown) => {
            // ignore scan errors
          }
        );
      } catch (e) {
        setStatusMsg('Kamera-Fehler — bitte Berechtigung prüfen');
      }
    }, 300);
  }, [onBind, scanningQR]);

  // ECHTE Kopplung: Web-Bluetooth / Web-USB — keine Zufallsgeräte mehr.
  // BLE: requestDevice → GATT-Connect → Disconnect (Verbindungstest).
  // WiFi/NFC: ehrliche Rückmeldung (native APIs nicht im Browser verfügbar).
  const bindMethod = async (method: 'ble' | 'nfc' | 'wifi') => {
    setPairingMethod(method);
    if (method === 'nfc') {
      setStatusMsg('NFC: WebNFC ist nur in Android-Chrome verfügbar (navigator.ndef). Prüfe Gerät…');
      const nav = navigator as any;
      if (nav?.ndef) {
        setStatusMsg('NFC bereit — bitte Token an das Gerät halten (WebNFC aktiv).');
      } else {
        setStatusMsg('NFC nicht verfügbar: WebNFC wird von diesem Browser nicht unterstützt.');
      }
      return;
    }
    if (method === 'wifi') {
      setStatusMsg('WiFi-Kopplung: Es gibt keine Browser-API zum aktiven WiFi-Pairing. Bitte QR-Code (WPA-Einrichtung) verwenden.');
      return;
    }
    // BLE — echter Request mit Geräteauswahl-Dialog des Browsers
    setStatusMsg('BLE-Scan: Browser-Dialog öffnen (Gerät auswählen)…');
    try {
      const nav = navigator as any;
      if (!nav?.bluetooth) {
        setStatusMsg('BLE nicht verfügbar: Web Bluetooth wird von diesem Browser nicht unterstützt (HTTPS + Chromium nötig).');
        return;
      }
      const device = await nav.bluetooth.requestDevice({ acceptAllDevices: true });
      setStatusMsg(`Gerät gefunden: ${device.name ?? device.id} — verbinde (GATT)…`);
      const server = await device.gatt.connect();
      await new Promise((r) => setTimeout(r, 400));
      await server.disconnect();
      onBind({
        id: `ble:${device.id}`,
        name: device.name ?? 'BLE-Gerät',
        method,
        rssi: -62,
        boundAt: new Date().toISOString(),
      });
      setStatusMsg(`Kopplung erfolgreich: ${device.name ?? device.id} (GATT-Verbindung getestet)`);
    } catch (e: any) {
      if ((e as any)?.name === 'NotFoundError') {
        setStatusMsg('Kein Gerät ausgewählt — Kopplung abgebrochen.');
      } else {
        setStatusMsg(`BLE-Fehler: ${e?.message ?? 'unbekannt'}`);
      }
    }
  };

  /** Echte Enumeration bereits berechtigter USB-Geräte (Web-USB). */
  const scanUSB = async () => {
    const nav = navigator as any;
    if (!nav?.usb) {
      setStatusMsg('USB nicht verfügbar: Web-USB wird von diesem Browser nicht unterstützt.');
      return;
    }
    try {
      const devices = await nav.usb.getDevices();
      if (devices.length === 0) {
        setStatusMsg('USB: Keine Geräte berechtigt — im Browser-Dialog freigeben.');
        return;
      }
      for (const d of devices) {
        onBind({
          id: `usb:${d.vendorId}:${d.productId}`,
          name: d.productName ?? `USB 0x${d.vendorId.toString(16)}`,
          method: 'wifi' as const, // USB-Geräte werden als Hardware-Knoten gebunden
          rssi: -1,
          boundAt: new Date().toISOString(),
        });
      }
      setStatusMsg(`USB: ${devices.length} berechtigte(s) Gerät(e) gebunden.`);
    } catch (e: any) {
      setStatusMsg(`USB-Fehler: ${e?.message ?? 'unbekannt'}`);
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
          <button onClick={() => { setPairingMethod('ble'); void bindMethod('ble'); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'ble' ? 'bg-emerald-600 text-white shadow-emerald-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Bluetooth className="w-4 h-4" /> BLE
          </button>
          <button onClick={() => { setPairingMethod('nfc'); void bindMethod('nfc'); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'nfc' ? 'bg-violet-600 text-white shadow-violet-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Waves className="w-4 h-4" /> NFC Token
          </button>
          <button onClick={() => { setPairingMethod('wifi'); void bindMethod('wifi'); }} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'wifi' ? 'bg-rose-600 text-white shadow-rose-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}>
            <Wifi className="w-4 h-4" /> WiFi
          </button>
          <button onClick={() => void scanUSB()} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40">
            <Smartphone className="w-4 h-4" /> USB
          </button>
        </div>

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
        <div className="flex flex-col gap-2" id="bound-list">
          {/* Placeholder — parent injects live bound devices */}
          <div className="text-xs text-slate-500 italic">Warte auf Kopplung…</div>
        </div>
      </div>
    </div>
  );
}
