/**
 * NfcReader – WebNFC-NDEF-Read für NTag-Smart-Tracker (README-Komponente).
 *
 * Aktiviert den echten NDEF-Lese-Pfad über die WebNFC-API (nur Chromium +
 * Android, secure context). Ohne NDEFReader-Support wird ein klarer
 * Hinweis angezeigt – die BLE-Suite bleibt darüber voll funktionsfähig.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Waves, X, RefreshCw, ShieldAlert } from 'lucide-react';

interface NfcReadResult {
  message: string;
  records: Array<{ type: string; data: string }>;
  time: string;
}

interface NDEFRecordData {
  type?: string;
  recordType?: string;
  mediaType?: string;
  data?: ArrayBuffer | string;
}

declare global {
  interface Window {
    NDEFReader?: new () => {
      scan: () => Promise<void>;
      onreading: ((event: { message?: { records?: NDEFRecordData[] } }) => void) | null;
      onreadingerror: ((event: unknown) => void) | null;
    };
  }
}

function decodeRecord(rec: NDEFRecordData): { type: string; data: string } {
  const type = rec.recordType ?? rec.type ?? '?';
  if (typeof rec.data === 'string') return { type, data: rec.data };
  if (rec.data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(rec.data);
    // Text-Dekodierung für UTF-8-Payloads
    try {
      return { type, data: new TextDecoder('utf-8').decode(bytes) };
    } catch {
      return { type, data: `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}` };
    }
  }
  return { type, data: '(leer)' };
}

export default function NfcReader({ onTagRead }: { onTagRead?: (result: NfcReadResult) => void }) {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<NfcReadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readerRef = useRef<{ scan: () => Promise<void>; onreading: unknown; onreadingerror: unknown } | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!window.NDEFReader);
  }, []);

  const stop = useCallback(() => {
    setScanning(false);
    readerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!window.NDEFReader) {
      setError('WebNFC nicht verfügbar – dieser Browser/ dieses Gerät unterstützt kein NDEF-Lesen.');
      return;
    }
    setError(null);
    setScanning(true);
    try {
      const reader = new window.NDEFReader();
      reader.onreading = (event) => {
        const records = (event.message?.records ?? []).map(decodeRecord);
        const text = records.map(r => r.data).filter(Boolean).join(' | ');
        const res: NfcReadResult = {
          message: text || '(kein Text-NDEF)',
          records,
          time: new Date().toLocaleTimeString('de-DE'),
        };
        setResult(res);
        onTagRead?.(res);
      };
      reader.onreadingerror = () => {
        setError('Kein NDEF-Tag in Reichweite – bitte NTag näher halten.');
      };
      await reader.scan();
      readerRef.current = reader;
    } catch (e) {
      setScanning(false);
      setError(`NFC-Scan konnte nicht gestartet werden: ${String(e)}`);
    }
  }, [onTagRead]);

  return (
    <div className="rounded-2xl border border-violet-500/25 bg-violet-950/15 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-xs font-black text-violet-200 flex items-center gap-2">
          <Waves className="w-3.5 h-3.5 text-violet-300" /> NTag/NFC lesen (WebNFC-NDEF)
        </h4>
        {supported ? (
          <span className="text-[9px] font-bold text-emerald-300 border border-emerald-700/40 bg-emerald-950/40 px-2 py-0.5 rounded-full">
            WebNFC aktiv
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[9px] font-bold text-amber-300 border border-amber-700/40 bg-amber-950/40 px-2 py-0.5 rounded-full">
            <ShieldAlert className="w-3 h-3" /> nicht unterstützt
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {scanning ? (
          <button
            onClick={stop}
            className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-500 transition"
          >
            <X className="w-3 h-3" /> Lesen beenden
          </button>
        ) : (
          <button
            onClick={() => start()}
            disabled={!supported}
            className="flex items-center gap-1.5 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white hover:brightness-110 transition disabled:opacity-40"
          >
            <RefreshCw className="w-3 h-3" /> NTag scannen
          </button>
        )}
        {scanning && <span className="text-[10px] font-mono text-violet-300 animate-pulse">Bereit – NTag in die Nähe halten…</span>}
      </div>

      {result && (
        <div className="mt-3 bg-[#020617] border border-violet-800/30 rounded-lg px-3 py-2 font-mono text-[10px] text-violet-200">
          <div className="text-slate-500 mb-1">Letzter NDEF-Read ({result.time}):</div>
          <div>{result.message}</div>
          {result.records.map((r, i) => (
            <div key={i} className="text-slate-400">· [{r.type}] {r.data}</div>
          ))}
        </div>
      )}
      {error && (
        <div className="mt-3 bg-rose-950/30 border border-rose-800/30 rounded-lg px-3 py-2 font-mono text-[10px] text-rose-200">
          {error}
        </div>
      )}
      {!supported && (
        <div className="mt-3 text-[9px] font-mono text-slate-500 leading-relaxed">
          WebNFC benötigt Chromium auf Android im sicheren Kontext (HTTPS).
          NTag-Tracker bleiben über den BLE-Scan der Suite vollständig bedienbar.
        </div>
      )}
    </div>
  );
}
