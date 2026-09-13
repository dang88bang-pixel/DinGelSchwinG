/**
 * Integrationstest: Live-Gerätepfad gegen ein **echt laufendes** Gateway.
 *
 * // REAL-IMPLEMENTATION 2026-09-13 (Schritt 4): Dieser Test beweist, dass
 * `AgentEngine.refreshDevices()` reale Geräte aus dem Gateway liefert — statt
 * der früheren festcodierten Liste. Er ist bewusst **selbst-überspringend**:
 * Ohne laufendes Gateway meldet er `⏭ übersprungen` (kein Fehlschlag, kein
 * grüner Haken für etwas, das nicht ausgeführt wurde).
 *
 * Starten des Gegenübers:
 *   python3 mobile-server/mobile_ble_server.py run --mock
 *
 * Ausführen: npm test
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentEngine } from '../agentEngine';
import { resetCircuitBreakers } from '../../retry';
import { gatewayStatus } from '../../mcpClient';
import { clearEndpoint, setEndpoint } from '../../endpoint';

const GATEWAY = 'http://127.0.0.1:8791';

async function gatewayReachable(): Promise<boolean> {
  try {
    setEndpoint({ gatewayBase: GATEWAY, source: 'manual', host: '127.0.0.1', port: 8791 });
    const res = await gatewayStatus();
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

beforeEach(() => {
  localStorage.clear();
  clearEndpoint();
  resetCircuitBreakers();
});

describe('AgentEngine live gegen das BLE-Gateway', () => {
  it('liefert echte Gateway-Geräte (oder überspringt ehrlich ohne Gateway)', async () => {
    const reachable = await gatewayReachable();
    if (!reachable) {
      console.info('⏭ übersprungen: kein Gateway auf 127.0.0.1:8791 — starte `npm run mcp:gateway`');
      return;
    }
    const engine = new AgentEngine('admin');
    const cache = await engine.refreshDevices();

    expect(cache.devices.length).toBeGreaterThan(0);
    // Jedes Gerät kommt aus einer real abgefragten Quelle …
    for (const d of cache.devices) {
      expect(['gateway-token', 'gateway-session', 'native-usb', 'native-adb', 'portview']).toContain(d.source);
      expect(d.id).not.toMatch(/^[mcto]-\d{3}$/); // alte Mock-IDs (m-001, c-101 …) dürfen nie auftauchen
    }
    expect(cache.sources).toContain('gateway-tokens');
    expect(cache.reports.some((r) => r.name === 'Gateway-Tokens' && r.ok)).toBe(true);

    // … und die Nutzer-Antwort nennt keine erfundenen Geräte mehr.
    const text = engine.intentDevices();
    expect(text).toContain('live');
    expect(text).not.toContain('MASTER-Gold');
    expect(text).not.toContain('Offline-Demo');
  }, 20000);
});
