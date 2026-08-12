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

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
    throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status, body.code ?? 'ERROR');
  }
  return res.json() as Promise<T>;
}

/**
 * Kritische Aktion (WebAuthn-Pflicht): 428 → Challenge/Assertion abrufen und
 * mit X-WebAuthn-Token automatisch erneut senden (FIDO2-Bestätigung).
 */
export async function requestCritical<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) {
      // WebAuthn-Assertion holen (HMAC-signierte Challenge des Hosts)
      const ch = await request<{ challenge: string }>('/webauthn/challenge', { method: 'POST' });
      const ass = await request<{ ok: boolean; token: string }>('/webauthn/assert', {
        method: 'POST',
        body: JSON.stringify({ challenge: ch.challenge }),
      });
      if (ass.ok) {
        const headers = { ...(options.headers as Record<string, string> | undefined) };
        headers['X-WebAuthn-Token'] = ass.token;
        return await request<T>(path, { ...options, headers });
      }
    }
    throw e;
  }
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

  async bleConnect(deviceId: string, action: 'connect' | 'disconnect' = 'connect'): Promise<{ ok: boolean; message?: string; error?: string }> {
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

  // Virtuelle Peripherals (echte GATT-Server auf dem Host)
  async virtualList(): Promise<VirtualPeripheral[]> {
    return request('/ble/virtual');
  },

  async virtualSpawn(name: string, deviceClass: string, distanceM = 3): Promise<VirtualPeripheral> {
    return request('/ble/virtual', { method: 'POST', body: JSON.stringify({ name, deviceClass, distanceM }) });
  },

  async virtualRemove(deviceId: string): Promise<{ ok: boolean }> {
    return request(`/ble/virtual/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },

  // Sniffer – echte ATT-Frames vom Host
  async snifferFrames(limit = 40): Promise<SnifferFrame[]> {
    return request(`/ble/sniffer?limit=${limit}`);
  },

  async bleTestRun(suiteId: string): Promise<{ ok: boolean; results?: Record<string, string> }> {
    return request(`/ble/tests/${encodeURIComponent(suiteId)}/run`, { method: 'POST' });
  },

  async snifferClear(): Promise<{ ok: boolean }> {
    return request('/ble/sniffer/clear', { method: 'POST' });
  },

  // Mesh (serverseitiger Zustand, zentrale Schlüssel)
  async meshList(): Promise<MeshNetworkApi[]> {
    return request('/ble/mesh/networks');
  },

  async meshCreate(name: string): Promise<{ ok: boolean; network?: MeshNetworkApi; error?: string }> {
    return request('/ble/mesh/networks', { method: 'POST', body: JSON.stringify({ name }) });
  },

  async meshProvision(networkId: string, deviceId: string): Promise<{ ok: boolean; node?: MeshNodeApi; error?: string }> {
    return request(`/ble/mesh/networks/${encodeURIComponent(networkId)}/provision`, {
      method: 'POST', body: JSON.stringify({ deviceId }),
    });
  },

  async meshPubsub(networkId: string, nodeId: string, pub: string, sub: string): Promise<{ ok: boolean; error?: string }> {
    return request(`/ble/mesh/networks/${encodeURIComponent(networkId)}/nodes/${encodeURIComponent(nodeId)}/pubsub`, {
      method: 'PUT', body: JSON.stringify({ pub, sub }),
    });
  },

  async meshTtl(networkId: string, ttl: number): Promise<{ ok: boolean; error?: string }> {
    return request(`/ble/mesh/networks/${encodeURIComponent(networkId)}/ttl`, {
      method: 'PUT', body: JSON.stringify({ ttl }),
    });
  },

  async meshModel(networkId: string, nodeId: string, model: string): Promise<{ ok: boolean; error?: string }> {
    return request(`/ble/mesh/networks/${encodeURIComponent(networkId)}/nodes/${encodeURIComponent(nodeId)}/model`, {
      method: 'PUT', body: JSON.stringify({ model }),
    });
  },

  async meshDelete(networkId: string): Promise<{ ok: boolean; error?: string }> {
    return request(`/ble/mesh/networks/${encodeURIComponent(networkId)}`, { method: 'DELETE' });
  },

  // Fehlersimulation (echte ATT-Fehler am verbundenen Peripheral)
  async injectFault(deviceId: string, kind: string): Promise<{ ok: boolean; message?: string; error?: string }> {
    return request(`/ble/devices/${encodeURIComponent(deviceId)}/fault`, {
      method: 'POST', body: JSON.stringify({ kind }),
    });
  },

  // Admin-Benutzerverwaltung (RBAC)
  async adminUsers(): Promise<Array<{ username: string; role: string; source: string }>> {
    return request('/admin/users');
  },

  async adminCreateUser(username: string, password: string, role: string): Promise<{ ok: boolean; username?: string; error?: string }> {
    return request('/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role }) });
  },

  async adminDeleteUser(username: string): Promise<{ ok: boolean; error?: string }> {
    return request(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
  },

  // Audit-Logs mit Trace-ID
  async auditLogs(q = '', limit = 200): Promise<Array<{ ts: string; user: string; role: string; action: string; detail: string; critical?: boolean; trace_id: string }>> {
    return request(`/audit/logs?q=${encodeURIComponent(q)}&limit=${limit}`);
  },

  // SSH-Key hinterlegen
  async sshKeyStatus(): Promise<{ configured: boolean; path: string }> {
    return request('/settings/ssh-key');
  },

  async sshKeyUpload(key: string): Promise<{ ok: boolean; configured?: boolean; error?: string }> {
    return request('/settings/ssh-key', { method: 'POST', body: JSON.stringify({ key }) });
  },

  // WebAuthn/FIDO2-Registrierung
  async webauthnRegisterChallenge(): Promise<{ challenge: string; challenge_b64: string; username: string; user_id_b64: string; rp: string }> {
    return request('/webauthn/register/challenge');
  },

  async webauthnRegister(credentialId: string, deviceName: string): Promise<{ ok: boolean; credentialId?: string; error?: string }> {
    return request('/webauthn/register', { method: 'POST', body: JSON.stringify({ credentialId, deviceName }) });
  },

  async webauthnCredentials(): Promise<{ credentials: Array<{ credentialId: string; deviceName: string; registeredAt: string }>; required: boolean }> {
    return request('/webauthn/credentials');
  },

  async webauthnDelete(credentialId: string): Promise<{ ok: boolean }> {
    return request(`/webauthn/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
  },

  // ------------------------------------------------------------------
  // Closed-Loop #1: dynamische RBAC-Matrix (Admin-UI → Backend-Autorisierung)
  // ------------------------------------------------------------------
  async adminRbac(): Promise<RbacMatrix> {
    return request('/admin/rbac');
  },

  async adminRbacSet(action: string, role: string, allow: boolean): Promise<{ ok: boolean }> {
    return requestCritical('/admin/rbac', {
      method: 'PATCH',
      body: JSON.stringify({ action, role, allow }),
    });
  },

  async adminRbacReset(action: string, role: string): Promise<{ ok: boolean }> {
    return requestCritical('/admin/rbac', {
      method: 'PATCH',
      body: JSON.stringify({ action, role, reset: true }),
    });
  },

  // ------------------------------------------------------------------
  // Closed-Loop #2: Feature-Toggles (UI → Background-Services)
  // ------------------------------------------------------------------
  async systemFeatures(): Promise<{ features: Record<string, boolean>; defaults: Record<string, boolean> }> {
    return request('/system/features');
  },

  async systemFeaturesPatch(features: Record<string, boolean>): Promise<{ ok: boolean; features: Record<string, boolean> }> {
    return requestCritical('/system/features', {
      method: 'PATCH',
      body: JSON.stringify({ features }),
    });
  },

  // ------------------------------------------------------------------
  // Closed-Loop #5: Live-Metriken (Dashboard-Widgets)
  // ------------------------------------------------------------------
  async metricsLive(): Promise<LiveMetrics> {
    return request('/metrics/live');
  },

  // ------------------------------------------------------------------
  // Closed-Loop #4 + Aktiver Agent: gebundene Geräte & Befehlausführung
  // ------------------------------------------------------------------
  async boundDevices(): Promise<BoundDevice[]> {
    const body = await request<{ devices: BoundDevice[] }>('/devices/bound');
    return body.devices.map((d) => ({ ...d, status: d.online ? 'online' : 'offline' as const }));
  },

  async deviceBind(nodeId: string, alias = '', protocol = '', address = ''): Promise<{ ok: boolean; device?: BoundDevice; error?: string }> {
    return request('/devices/bind', { method: 'POST', body: JSON.stringify({ nodeId, alias, protocol, address }) });
  },

  async deviceUnbind(deviceId: string): Promise<{ ok: boolean }> {
    return request(`/devices/bind/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  },

  // Grafische Gerätesteuerung (Device-Cards): Volume/Play/Pause/Reboot/Status
  async deviceControl(deviceId: string, action: string, value?: number): Promise<{
    ok: boolean;
    action: string;
    alias?: string;
    output?: string;
    error?: string;
    battery?: number;
    analysis?: { summary?: string; status?: string; metrics?: Record<string, unknown> };
  }> {
    return request(`/devices/${encodeURIComponent(deviceId)}/control`, {
      method: 'POST',
      body: JSON.stringify({ action, value }),
    });
  },

  // Discovery-Center: ungebundene Geräte scannen
  async discoveryScan(): Promise<{ devices: DiscoveredNode[]; count: number }> {
    return request('/discovery/scan', { method: 'POST' });
  },

  // Activity-Feed: letzte Aktionen
  async auditActivity(limit = 20): Promise<ActivityEntry[]> {
    return request(`/audit/activity?limit=${limit}`);
  },

  async agentExecute(command: string, target: string): Promise<AgentExecuteResult> {
    return request('/agent/execute', { method: 'POST', body: JSON.stringify({ command, target }) });
  },
};

export interface VirtualPeripheral {
  id: string;
  name: string;
  port: number;
  rssi: number;
  tx_power: number;
  distance_m: number;
  battery: number;
  serviceUuids: string[];
  adDataHex: string;
  uptime_s: number;
}

export interface MeshNodeApi {
  id: string;
  name: string;
  unicast: string;
  role: string;
  rssi: number;
  battery: number;
  online: boolean;
  pub: string;
  sub: string;
  ttl: number;
  models: string[];
}

export interface MeshNetworkApi {
  id: string;
  name: string;
  netKey: string;
  appKey: string;
  ttl: number;
  nodes: MeshNodeApi[];
  provisionedAt?: string;
}

export interface SnifferFrame {
  time: string;
  deviceId: string;
  dir: 'rx' | 'tx';
  opcode: number;
  hex: string;
}

export interface RbacMatrix {
  roles: string[];
  actions: string[];
  defaults: Record<string, number>;
  overrides: Record<string, Record<string, boolean>>;
  matrix: Record<string, Record<string, boolean>>;
}

export interface LiveMetrics {
  cpu_percent: number | null;
  ram_percent: number | null;
  uptime_s: number;
  backend: string;
  connected_devices: number;
  bound_devices: number;
  clients_online: number;
  features: Record<string, boolean>;
  alerts: Array<{ action: string; detail: string; ts: string; trace_id: string }>;
  time: number;
}

export interface BoundDevice {
  id: string;
  alias: string;
  label: string;
  kind: string;
  protocol: string;
  address: string;
  ip: string;
  mac: string;
  capabilities: string[];
  online: boolean;
  connected: boolean;
  battery?: number;
  http?: boolean;
  status: 'online' | 'offline' | 'unknown';
}

export interface DiscoveredNode {
  id: string;
  name: string;
  ip: string;
  mac: string;
  protocol: string;
  kind: string;
  rssi?: number;
  http?: boolean;
  is_bindable: boolean;
}

export interface ActivityEntry {
  id: string;
  type: 'job' | 'status' | 'bind' | 'error';
  device: string;
  action: string;
  result: 'success' | 'failed' | 'pending';
  timestamp: string;
  message: string;
}

export interface AgentExecuteResult {
  ok: boolean;
  reply?: string;
  error?: string;
  results?: Array<{
    alias: string;
    ok: boolean;
    output?: string;
    error?: string;
    analysis?: { summary?: string; status?: string };
  }>;
}
