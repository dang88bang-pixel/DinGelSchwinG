import { useState } from 'react';
import { Waves } from 'lucide-react';
import { readNdefTag } from '../lib/nfc';
import { registry } from '../lib/devices/registry';

export default function NfcReader() {
  const [status, setStatus] = useState('Bereit');
  const [last, setLast] = useState<string | null>(null);

  const scan = async () => {
    setStatus('Feld aktiv — Tag halten…');
    try {
      const tag = await readNdefTag();
      setLast(`${tag.serial}: ${tag.records.join(' ').slice(0, 80)}`);
      await registry.bind({
        id: tag.id,
        name: `NTag ${tag.serial.slice(0, 8)}`,
        type: 'client',
        kind: 'ntag',
        source: 'nfc',
        method: 'nfc',
        rssi: -48,
        txPower: -59,
        x: 1.2, y: 0.4, z: -0.8,
        bound: true,
        online: true,
      });
      setStatus('Tag gelesen und gebunden');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'NFC fehlgeschlagen');
    }
  };

  return (
    <div className="glass-card p-4">
      <h3 className="text-sm font-black text-white flex items-center gap-2 mb-2"><Waves className="w-4 h-4 text-violet-300" /> NTag / NFC</h3>
      <button onClick={() => void scan()} className="text-xs font-extrabold px-3 py-1.5 rounded-lg bg-violet-700 text-white">Tag lesen</button>
      <p className="mt-2 text-[11px] font-mono text-slate-400">{status}</p>
      {last && <p className="text-[11px] font-mono text-violet-200 mt-1">{last}</p>}
    </div>
  );
}
