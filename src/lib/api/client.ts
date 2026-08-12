/**
 * ApiClient – Anbindung der Web-App an das Host-Backend (REST :5000, via
 * Vite-Proxy /api). Login/JWT, Health, BLE-Endpunkte, Agent, WebAuthn.
 * Fehlt der Host (offline), melden die Aufrufe einen klaren Fehler –
 * die App fällt dann auf den lokalen SuiteStore zurück.
 */
import { bleSuiteStore } from '../ble/suiteStore';

export interface HostStatus {
  status: string;
  service: string;
  backend: 'bleak' | 'sim';
  time: number;
}

const BASE = '/api';

let _token: string | null = null;
let _role = 'developer';
let _hostReachable = false;

export function setAuth(token: string, role: string): void {
  _token = token;
  _role = role;
  // Rolle der Suite-Instanz spiegeln
  bleSuiteStore.setRole(role as 'service' | 'developer' | 'admin');
}

export function getToken(): string | null {
  return _token;
}

export function getRole(): string {
  return _role;
}

export function isHostReachable(): boolean {
  return _hostReachable;
}

export function setHostReachable(value: boolean): void {
  _hostReachable = value;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async health(): Promise<HostStatus> {
    const res = await fetch(`${BASE}/health`);
    const body = (await res.json()) as HostStatus;
    setHostReachable(res.ok);
    return body;
  },

  async login(email: string, password: string): Promise<{ token: string; role: string }> {
    const body = await request<{ token: string; role: string }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuth(body.token, body.role);
    return body;
  },

  /**
   * Einmalige Host-Verbindung (idempotent): Health → Login (Service-Demo) →
   * Token für WS-Kanäle. true, wenn der Host erreichbar ist.
   */
  async ensureHost(): Promise<boolean> {
    if (isHostReachable() && _token) return true;
    try {
      const health = await api.health();
      if (health.status !== 'ok') return false;
      if (!_token) {
        await api.login('service', 'svc123');
      }
      setHostReachable(true);
      return true;
    } catch {
      setHostReachable(false);
      return false;
    }
  },

  /** Vollständiger Logout (Token verwerfen). */
  logout(): void {
    _token = null;
    _role = 'developer';
    setHostReachable(false);
    bleSuiteStore.setRole('developer');
  },

  async bleScan(action: 'start' | 'stop', duration = 5): Promise<{ backend: string; devices: unknown[] }> {
    return request('/ble/scan', { method: 'POST', body: JSON.stringify({ action, duration }) });
  },

  async bleDevices(): Promise<unknown[]> {
    return request('/ble/devices');
  },

  async bleConnect(deviceId: string, action: 'connect' | 'disconnect' = 'connect') {
    return request(`/ble/devices/${encodeURIComponent(deviceId)}/connect`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  async agentAsk(text: string): Promise<{ ok: boolean; reply: string }> {
    return request('/agent/ask', { method: 'POST', body: JSON.stringify({ text }) });
  },

  async webauthnChallenge(): Promise<{ challenge: string }> {
    return request('/webauthn/challenge', { method: 'POST' });
  },

  async webauthnAssert(challenge: string): Promise<{ ok: boolean; token: string }> {
    return request('/webauthn/assert', { method: 'POST', body: JSON.stringify({ challenge }) });
  },
};
