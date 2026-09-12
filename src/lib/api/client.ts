/**
 * REST-Client für das NEXUS-Backend (/api via Vite-Proxy).
 */
const TOKEN_KEY = 'nexus.jwt';

export function apiBase(): string {
  const env = (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE;
  if (env) return env.replace(/\/$/, '');
  return '';
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) {
    const err = data as { code?: string; message?: string } | null;
    throw new ApiError(res.status, err?.code || 'ERROR', err?.message || res.statusText);
  }
  return data as T;
}

export async function ensureSession(): Promise<string> {
  const existing = getToken();
  if (existing) {
    try {
      await api('/api/health');
      return existing;
    } catch {
      /* re-login */
    }
  }
  const body = await api<{ token: string }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin', password: 'admin' }),
  });
  setToken(body.token);
  return body.token;
}

export interface RemoteDevice {
  id: string;
  name?: string;
  label?: string;
  kind?: string;
  type?: 'master' | 'client' | 'target' | 'other';
  source?: string;
  ip?: string;
  path?: string;
  rssi?: number;
  txPower?: number;
  x?: number;
  y?: number;
  z?: number;
  bound?: boolean;
  online?: boolean;
  usbVendorId?: string;
  usbProductId?: string;
  method?: string;
  latencyMs?: number;
}

export async function fetchDevices(): Promise<RemoteDevice[]> {
  await ensureSession();
  return api<RemoteDevice[]>('/api/devices');
}

export async function scanBackend(deep = false, subnet = '192.168.1.0/24'): Promise<RemoteDevice[]> {
  await ensureSession();
  const q = `?subnet=${encodeURIComponent(subnet)}${deep ? '&deep=1' : ''}`;
  const res = await api<{ devices: RemoteDevice[] }>(`/api/discovery/scan${q}`, {
    method: deep ? 'POST' : 'GET',
  });
  return res.devices || [];
}

export async function bindRemote(device: RemoteDevice): Promise<RemoteDevice> {
  await ensureSession();
  return api<RemoteDevice>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({
      ...device,
      id: device.id,
      kind: device.kind || 'hardware',
      label: device.name || device.label,
      bound: true,
    }),
  });
}

export async function registerClient(device = ''): Promise<void> {
  await ensureSession();
  await api('/api/clients/register', {
    method: 'POST',
    body: JSON.stringify({ clientId: `web-${location.hostname}`, device, last_action: 'ui' }),
  });
}
