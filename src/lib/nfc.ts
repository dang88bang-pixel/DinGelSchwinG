/** WebNFC-NDEF-Read für NTag-Tracker. */
export interface NfcRead {
  id: string;
  serial: string;
  records: string[];
}

export async function readNdefTag(timeoutMs = 10000): Promise<NfcRead> {
  const Ctor = (window as unknown as {
    NDEFReader?: new () => {
      scan: () => Promise<void>;
      onreading: ((ev: { serialNumber?: string; message?: { records: Array<{ data?: BufferSource; recordType?: string }> } }) => void) | null;
    };
  }).NDEFReader;
  if (!Ctor) throw new Error('WebNFC nicht verfügbar');
  const reader = new Ctor();
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('NFC-Timeout')), timeoutMs);
    reader.onreading = (ev) => {
      window.clearTimeout(t);
      const records: string[] = [];
      for (const rec of ev.message?.records || []) {
        if (rec.data) {
          try {
            records.push(new TextDecoder().decode(rec.data));
          } catch {
            records.push(`[${rec.recordType || 'bin'}]`);
          }
        }
      }
      const serial = ev.serialNumber || `${Date.now()}`;
      resolve({ id: `nfc:${serial}`, serial, records });
    };
    reader.scan().catch((e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });
}
