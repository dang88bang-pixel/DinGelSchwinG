export const LEVELS: Record<string, number> = {
  guest: 0,
  operator: 1,
  service: 2,
  developer: 3,
  expert: 4,
  emergency: 5,
  admin: 5,
};

const ACTION_MIN: Record<string, string> = {
  'devices.read': 'operator',
  'devices.write': 'service',
  'terminal.hardware': 'service',
  'terminal.network.ssh': 'developer',
  'terminal.dongle.flash': 'developer',
  'discovery.scan': 'service',
  'signal.analyze': 'service',
};

export function roleLevel(role: string): number {
  return LEVELS[(role || 'guest').toLowerCase()] ?? 0;
}

export function allows(role: string, action: string): boolean {
  const need = ACTION_MIN[action] || 'emergency';
  return roleLevel(role) >= roleLevel(need);
}

export function requireAction(role: string, action: string): void {
  if (!allows(role, action)) {
    const err = new Error(`RBAC_DENIED: ${action}`);
    (err as Error & { code: string }).code = 'RBAC_DENIED';
    throw err;
  }
}

export function requireRole(role: string, min: string): void {
  if (roleLevel(role) < roleLevel(min)) {
    const err = new Error(`RBAC_DENIED: min ${min}`);
    (err as Error & { code: string }).code = 'RBAC_DENIED';
    throw err;
  }
}

export function deviceRightsFor(role: string, resource: string): string[] {
  const lvl = roleLevel(role);
  if (resource === 'network') return lvl >= 3 ? ['read', 'write', 'update', 'delete'] : ['read'];
  if (resource === 'ble_token' || resource === 'ntag') {
    if (lvl >= 3) return ['read', 'write', 'update', 'delete'];
    return lvl >= 2 ? ['read'] : [];
  }
  if (lvl >= 2) return ['read', 'write', 'update', 'delete'];
  if (lvl >= 1 && resource === 'hardware') return ['read'];
  return [];
}
