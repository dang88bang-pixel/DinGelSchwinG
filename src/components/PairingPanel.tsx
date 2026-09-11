// REAL-IMPLEMENTATION 2026-09-11
// Pairing accepts only data observed through a physical QR/NFC/BLE path. It
// never invents a device name, RSSI value, or successful hardware operation.
import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Bluetooth, Waves, Wifi, ShieldCheck, Smartphone, Zap, RefreshCw } from 'lucide-react';
import { gatewayCommand, gatewayNfcRead } from '../lib/mcpClient';

export interface PairedDevice {
  id: string;
  name: string;
  method: 'qr' | 'ble' | 'nfc' | 'wifi';
  /** RSSI is unavailable for QR/NFC; consumers must not infer a fake value. */
  rssi?: number;
  /** Transmit power is optional because bluetoothctl does not always expose it. */
  txPower?: number;
  boundAt: string;
  verified?: boolean;
}

type PairingMethod = PairedDevice['method'];
type GatewayDevice = Record<string, unknown>;
type NdefRecord = { recordType?: string; data?: DataView | ArrayBuffer | null };
type NdefReadingEvent = Event & { serialNumber?: string; message?: { records?: NdefRecord[] } };
type NdefReader = { scan(options?: { signal?: AbortSignal }): Promise<void>; onreading: ((event: NdefReadingEvent) => void) | null; onreadingerror: (() => void) | null };
type NdefReaderConstructor = new () => NdefReader;

const DEVICE_ID = /^[A-Za-z0-9._:-]{2,128}$/;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readNdefText(event: NdefReadingEvent): string {
  const record = event.message?.records?.find((item) => item.recordType === 'text' || item.recordType === 'url') ?? event.message?.records?.[0];
  if (!record?.data) return '';
  // The Web NFC spec exposes an ArrayBuffer.  Accepting DataView as well keeps
  // the adapter compatible with WebView implementations without inventing data.
  const bytes = record.data instanceof DataView
    ? new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
    : new Uint8Array(record.data);
  return new TextDecoder().decode(bytes);
}

function parseQrDescriptor(decodedText: string): Omit<PairedDevice, 'boundAt' | 'method'> | null {
  const text = decodedText.trim();
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch {
    try {
      const url = new URL(text);
      if (url.protocol === 'dgs-pair:' || url.protocol === 'https:') {
        payload = {
          id: url.searchParams.get('id') ?? undefined,
          name: url.searchParams.get('name') ?? undefined,
          rssi: url.searchParams.get('rssi') ?? undefined,
          txPower: url.searchParams.get('txPower') ?? undefined,
          verified: url.searchParams.get('verified') === 'true',
        };
      }
    } catch {
      return null;
    }
  }
  const id = stringValue(payload?.id ?? payload?.device_id ?? payload?.token_id);
  const name = stringValue(payload?.name ?? payload?.label ?? payload?.device_name);
  if (!id || !name || !DEVICE_ID.test(id)) return null;
  return {
    id,
    name,
    rssi: numberValue(payload?.rssi),
    txPower: numberValue(payload?.txPower ?? payload?.tx_power),
    verified: payload?.verified === true,
  };
}

function toPairedBleDevice(raw: GatewayDevice): PairedDevice | null {
  const id = stringValue(raw.id ?? raw.address ?? raw.token_id);
  if (!id || !DEVICE_ID.test(id)) return null;
  return {
    id,
    name: stringValue(raw.name ?? raw.label) ?? id,
    method: 'ble',
    rssi: numberValue(raw.rssi),
    txPower: numberValue(raw.tx_power ?? raw.txPower),
    boundAt: new Date().toISOString(),
    // A scan proves visibility, not a cryptographic pairing.
    verified: false,
  };
}

export default function PairingPanel({ onBind }: { onBind: (device: PairedDevice) => void }) {
  const [scanningQR, setScanningQR] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scannerTimerRef = useRef<number | null>(null);
  const nfcAbortRef = useRef<AbortController | null>(null);
  const handledQrRef = useRef(false);
  const [pairingMethod, setPairingMethod] = useState<PairingMethod>('qr');
  const [statusMsg, setStatusMsg] = useState('Bereit zur Kopplung');
  const [discovered, setDiscovered] = useState<PairedDevice[]>([]);
  const [bound, setBound] = useState<PairedDevice[]>([]);
  const [busy, setBusy] = useState(false);

  const stopQr = useCallback(() => {
    if (scannerTimerRef.current !== null) window.clearTimeout(scannerTimerRef.current);
    scannerTimerRef.current = null;
    scannerRef.current?.clear().catch(() => undefined);
    scannerRef.current = null;
    setScanningQR(false);
  }, []);

  useEffect(() => () => {
    stopQr();
    nfcAbortRef.current?.abort();
  }, [stopQr]);

  const bind = useCallback((device: PairedDevice) => {
    setBound((previous) => previous.some((item) => item.id === device.id)
      ? previous.map((item) => item.id === device.id ? device : item)
      : [...previous, device]);
    onBind(device);
  }, [onBind]);

  const handleQr = useCallback((decodedText: string) => {
    if (handledQrRef.current) return;
    handledQrRef.current = true;
    const descriptor = parseQrDescriptor(decodedText);
    if (!descriptor) {
      setStatusMsg('QR abgelehnt: erwartet wird ein DGS-Geräteobjekt mit gültiger id und name.');
      stopQr();
      return;
    }
    const device: PairedDevice = { ...descriptor, method: 'qr', boundAt: new Date().toISOString() };
    bind(device);
    setStatusMsg(device.verified
      ? `QR-Gerät ${device.name} wurde als verifiziert übernommen.`
      : `QR-Gerät ${device.name} übernommen (kein QR-Verifikationsvertrag im Gateway vorhanden).`);
    stopQr();
  }, [bind, stopQr]);

  const startQR = useCallback(() => {
    if (scanningQR || busy) return;
    handledQrRef.current = false;
    setPairingMethod('qr');
    setStatusMsg('QR-Scan aktiv — Kamera-Berechtigung erteilen.');
    setScanningQR(true);
    scannerTimerRef.current = window.setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner('qr-reader', {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        }, false);
        scannerRef.current = scanner;
        scanner.render(handleQr, () => undefined);
      } catch (error) {
        setStatusMsg(`Kamera-Fehler: ${errorMessage(error)}`);
        stopQr();
      }
    }, 0);
  }, [busy, handleQr, scanningQR, stopQr]);

  const startBleScan = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setPairingMethod('ble');
    setStatusMsg('BLE-Scan wird über das konfigurierte Gateway gestartet…');
    try {
      const response = await gatewayCommand('ble_scan', { timeout: 8 });
      if (!response.ok) throw new Error(String(response.reason ?? response.error ?? 'Gateway hat den Scan abgelehnt.'));
      if (response.backend === 'mock') {
        setDiscovered([]);
        setStatusMsg('Gateway läuft im Mock-Modus. Simulierte BLE-Geräte werden nicht als bindbar angezeigt.');
        return;
      }
      const devices = Array.isArray(response.devices)
        ? response.devices.filter((entry): entry is GatewayDevice => Boolean(entry) && typeof entry === 'object').map(toPairedBleDevice).filter((entry): entry is PairedDevice => entry !== null)
        : [];
      setDiscovered(devices);
      setStatusMsg(devices.length ? `${devices.length} tatsächlich gescannte BLE-Geräte verfügbar.` : 'Scan beendet: keine BLE-Geräte gefunden.');
    } catch (error) {
      setDiscovered([]);
      setStatusMsg(`BLE-Scan fehlgeschlagen: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const startNfcRead = useCallback(async () => {
    if (busy) return;
    setPairingMethod('nfc');
    const Reader = (globalThis as typeof globalThis & { NDEFReader?: NdefReaderConstructor }).NDEFReader;
    if (!Reader) {
      setStatusMsg('Web NFC ist in dieser Laufzeit nicht verfügbar. Kein NFC-Erfolg wurde simuliert.');
      return;
    }
    nfcAbortRef.current?.abort();
    const controller = new AbortController();
    nfcAbortRef.current = controller;
    setBusy(true);
    setStatusMsg('NFC-Leser aktiv — Token an das Gerät halten.');
    try {
      const reader = new Reader();
      reader.onreadingerror = () => setStatusMsg('NFC-Lesefehler. Token erneut an das Gerät halten.');
      reader.onreading = (event) => {
        void (async () => {
          try {
            const tokenId = event.serialNumber?.trim();
            if (!tokenId || !DEVICE_ID.test(tokenId)) throw new Error('NFC-Token enthält keine gültige Seriennummer.');
            const text = readNdefText(event);
            const response = await gatewayNfcRead({ token_id: tokenId, uid: event.serialNumber, ndef: text, agent: 'web-pairing' });
            if (!response.ok) throw new Error(String(response.reason ?? response.error ?? 'Gateway hat das Token abgelehnt.'));
            const device: PairedDevice = {
              id: tokenId,
              name: text || `NFC-Token ${tokenId}`,
              method: 'nfc',
              boundAt: new Date().toISOString(),
              verified: response.mode === 'gateway_crypto',
            };
            bind(device);
            setStatusMsg(`NFC-Token ${tokenId} ${device.verified ? 'kryptografisch verifiziert' : 'vom Gateway akzeptiert'}.`);
            controller.abort();
          } catch (error) {
            setStatusMsg(`NFC-Kopplung fehlgeschlagen: ${errorMessage(error)}`);
          } finally {
            setBusy(false);
          }
        })();
      };
      await reader.scan({ signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted) setStatusMsg(`NFC-Leser konnte nicht gestartet werden: ${errorMessage(error)}`);
      setBusy(false);
    }
  }, [bind, busy]);

  const unavailableWifi = useCallback(() => {
    setPairingMethod('wifi');
    setStatusMsg('WLAN-Scan ist im vorhandenen Browser-/Capacitor-Vertrag nicht implementiert. Kein Erfolg wurde simuliert.');
  }, []);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="bg-gradient-to-br from-slate-900/80 to-blue-950/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-4 shadow-2xl shadow-blue-900/10">
        <h2 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-400 flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-amber-300" /> Client-Kopplung
        </h2>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button type="button" onClick={startQR} disabled={busy} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'qr' ? 'bg-cyan-600 text-white shadow-cyan-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}><QrCode className="w-4 h-4" /> QR-Code</button>
          <button type="button" onClick={() => void startBleScan()} disabled={busy} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'ble' ? 'bg-emerald-600 text-white shadow-emerald-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}><Bluetooth className="w-4 h-4" /> BLE-Scan</button>
          <button type="button" onClick={() => void startNfcRead()} disabled={busy} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'nfc' ? 'bg-violet-600 text-white shadow-violet-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}><Waves className="w-4 h-4" /> NFC-Token</button>
          <button type="button" onClick={unavailableWifi} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition shadow-lg ${pairingMethod === 'wifi' ? 'bg-rose-600 text-white shadow-rose-900/40' : 'bg-slate-800/60 text-slate-200 hover:bg-slate-700/60 border border-slate-700/40'}`}><Wifi className="w-4 h-4" /> WLAN</button>
        </div>

        <div className={`text-xs font-mono mb-2 rounded-lg px-3 py-2 border ${pairingMethod === 'qr' ? 'bg-cyan-950/40 border-cyan-700/40 text-cyan-200' : pairingMethod === 'ble' ? 'bg-emerald-950/40 border-emerald-700/40 text-emerald-200' : pairingMethod === 'nfc' ? 'bg-violet-950/40 border-violet-700/40 text-violet-200' : 'bg-rose-950/40 border-rose-700/40 text-rose-200'}`}>{statusMsg}</div>

        {scanningQR && <div className="relative rounded-xl overflow-hidden border border-cyan-500/40 shadow-inner shadow-cyan-900/20 bg-black" id="qr-reader" style={{ minHeight: 240 }}><button type="button" onClick={stopQr} className="absolute top-2 right-2 z-10 bg-slate-900/80 text-white text-xs px-2 py-1 rounded-md hover:bg-slate-800">Abbrechen</button></div>}

        {pairingMethod === 'ble' && <div className="space-y-1.5 mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400"><span>Vom Gateway beobachtete Geräte</span><button type="button" onClick={() => void startBleScan()} disabled={busy} className="inline-flex items-center gap-1 hover:text-white"><RefreshCw className="w-3 h-3" /> erneut scannen</button></div>
          {discovered.map((device) => <button type="button" key={device.id} onClick={() => { bind(device); setStatusMsg(`BLE-Gerät ${device.name} aus dem realen Gateway-Scan übernommen (noch nicht kryptografisch gepairt).`); }} className="w-full text-left rounded-lg border border-emerald-800/40 bg-emerald-950/20 px-2.5 py-2 text-xs hover:bg-emerald-900/40"><b>{device.name}</b><span className="ml-2 text-emerald-300 font-mono">{device.rssi !== undefined ? `${device.rssi} dBm` : 'RSSI nicht verfügbar'}</span></button>)}
        </div>}
      </div>

      <div className="bg-gradient-to-br from-slate-900/60 to-blue-950/40 backdrop-blur-xl border border-slate-700/40 rounded-2xl p-4 flex-1 overflow-y-auto shadow-xl shadow-blue-900/5">
        <h3 className="text-sm font-bold text-slate-200 mb-2 flex items-center gap-2"><Smartphone className="w-4 h-4 text-amber-300" /> Gebundene Clients</h3>
        <div className="flex flex-col gap-2" id="bound-list">
          {bound.length === 0 ? <div className="text-xs text-slate-500 italic">Warte auf einen QR-, BLE- oder NFC-Nachweis…</div> : bound.map((device) => <div key={device.id} className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-2.5 py-2 text-xs"><div className="flex items-center gap-2"><ShieldCheck className={`w-3.5 h-3.5 ${device.verified ? 'text-emerald-300' : 'text-amber-300'}`} /><b className="text-slate-100">{device.name}</b></div><div className="mt-1 font-mono text-slate-400">{device.id} · {device.method.toUpperCase()} · {device.verified ? 'verifiziert' : 'sichtbar/ungeprüft'}</div></div>)}
        </div>
      </div>
    </div>
  );
}
