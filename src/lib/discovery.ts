/** Client-Interlock, deckungsgleich mit server/device_manager.py */
export const VID_WHITELIST = new Set(['2341', '16c0', '1a86', '0403']);

export function normalizeVid(vid?: string | null): string {
  return (vid || '').toLowerCase().replace(/^0x/, '');
}

export function runSafetyInterlockCheck(kind: string, usbVendorId?: string | null): { ok: boolean; code?: string; message?: string } {
  if (kind !== 'dongle') return { ok: true };
  const vid = normalizeVid(usbVendorId);
  if (!vid) return { ok: false, code: 'DONGLE_MISSING', message: 'Keine VID — Interlock blockiert' };
  if (!VID_WHITELIST.has(vid)) {
    return { ok: false, code: 'DONGLE_MISSING', message: `VID 0x${vid} nicht freigegeben` };
  }
  return { ok: true };
}

export interface DiscoveryNode {
  id: string;
  kind: string;
  label?: string;
  lastSeen?: string;
  signal?: { rssi?: number };
  usbVendorId?: string;
  usbProductId?: string;
  autoBindable?: boolean;
  online?: boolean;
  ip?: string;
}
