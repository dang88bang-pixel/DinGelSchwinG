/**
 * Tests für die ADB-Ausführung aus dem Web (Aktionskette A-5).
 *
 * A-5 „Fertig wenn“: ohne Träger bleibt es beim Plan/Skript, mit Träger steht
 * ein echter Exit-Code in der Antwort. Das Backend wird hier über einen
 * fetch-Stub nachgebildet — geprüft wird die Verdrahtung, nicht adb selbst
 * (dafür läuft `server/tests/test_adb_proxy.py` mit einem Fake-`adb`).
 *
 * Ausführen: npm test
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { AgentEngine } from '../agentEngine';
import { adbScriptKind, describeAdbCommand, parseAdbCommand } from '../adbCommand';
import { runAdb } from '../../api/client';
import { liveMetrics } from '../../liveMetrics';

/** Antworten des Backend-Stubs je Test. */
interface StubPlan {
  adbRun?: { status: number; body: Record<string, unknown> };
  calls: { url: string; body: Record<string, unknown> }[];
}

function stubBackend(plan: Partial<StubPlan> = {}): StubPlan {
  const state: StubPlan = { calls: [], ...plan };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    let body: Record<string, unknown> = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    } catch {
      body = {};
    }
    state.calls.push({ url: target, body });
    const json = (status: number, payload: Record<string, unknown>) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
    });
    if (target.includes('/api/health')) return json(200, { ok: true });
    if (target.includes('/api/login')) return json(200, { token: 'test-token' });
    if (target.includes('/api/adb/run')) {
      const preset = state.adbRun ?? {
        status: 200,
        body: {
          type: 'adb.result', ok: true, verb: String(body.verb ?? 'devices'), serial: null,
          argv: ['adb', 'devices', '-l'], carrier: { kind: 'local', name: 'adb' },
          exitCode: 0, output: 'List of devices attached', truncated: false,
          durationMs: 12, reason: 'exit-code', summary: '✅ devices (Exit-Code 0)',
        },
      };
      return json(preset.status, preset.body);
    }
    return json(404, { code: 'NOT_FOUND', message: target });
  }));
  return state;
}

beforeEach(() => {
  localStorage.clear();
  // Der Laufzeit-Cache ist ein Modul-Singleton — sonst serviert der zweite
  // `ask('adb devices')` die Antwort des ersten Tests.
  liveMetrics.clearCache();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseAdbCommand — Chat-Satz wird zum Whitelist-Antrag', () => {
  it('erkennt Geräte-Verb ohne Argumente', () => {
    const req = parseAdbCommand('adb devices');
    expect(req?.verb).toBe('devices');
    expect(req?.risky).toBe(false);
    expect(describeAdbCommand(req!)).toBe('adb devices -l');
  });

  it('liest Seriennummer, Zeilen und Tag aus', () => {
    const req = parseAdbCommand('adb -s R58M123ABC logcat lines=200 tag=System');
    expect(req?.verb).toBe('logcat');
    expect(req?.serial).toBe('R58M123ABC');
    expect(req?.args).toMatchObject({ lines: '200', tag: 'System' });
    expect(describeAdbCommand(req!)).toBe('adb -s R58M123ABC logcat -d -t 200 -s System');
  });

  it('behält den Shell-Befehl wörtlich', () => {
    const req = parseAdbCommand('adb shell getprop ro.build.version.sdk');
    expect(req?.verb).toBe('shell');
    expect(req?.args.command).toBe('getprop ro.build.version.sdk');
  });

  it('versteht deutsche Aliase und WiFi-Argumente', () => {
    expect(parseAdbCommand('zeige adb geräte')?.verb).toBe('devices');
    expect(parseAdbCommand('adb connect 192.168.1.20:5555')?.args.ip).toBe('192.168.1.20:5555');
    expect(parseAdbCommand('adb pull /sdcard/DCIM dcim')?.args).toMatchObject({
      remote: '/sdcard/DCIM', local: 'dcim',
    });
    expect(parseAdbCommand('adb tcpip 5555')?.args.port).toBe('5555');
  });

  it('markiert Risiko-Verben und erkennt mitgegebene Freigabe', () => {
    const reboot = parseAdbCommand('adb reboot bootloader');
    expect(reboot?.risky).toBe(true);
    expect(reboot?.approved).toBe(false);
    expect(reboot?.args.mode).toBe('bootloader');
    const install = parseAdbCommand('adb install app.apk freigabe=true');
    expect(install?.risky).toBe(true);
    expect(install?.approved).toBe(true);
    expect(install?.args.apk).toBe('app.apk');
  });

  it('lässt Verben außerhalb der Whitelist beim Plan-Pfad', () => {
    // `adb backup` ist kein Server-Verb → null, damit planAdb/generateAdbScript greift.
    expect(parseAdbCommand('erstelle adb backup skript')).toBeNull();
    expect(parseAdbCommand('adb pentest')).toBeNull();
    expect(parseAdbCommand('welche geräte sind online')).toBeNull();
  });

  it('mappt Verben auf Skript-Arten für den Fallback', () => {
    expect(adbScriptKind('logcat')).toBe('logs');
    expect(adbScriptKind('pull')).toBe('rescue');
    expect(adbScriptKind('connect')).toBe('connect');
    expect(adbScriptKind('devices')).toBeNull();
  });
});

describe('runAdb — REST-Client', () => {
  it('postet Verb, Seriennummer und Freigabe an /api/adb/run', async () => {
    const state = stubBackend();
    const result = await runAdb({ verb: 'reboot', serial: 'R58M123ABC', approve: true });
    expect(result.ok).toBe(true);
    const call = state.calls.find((c) => c.url.includes('/api/adb/run'));
    expect(call?.body).toMatchObject({ verb: 'reboot', serial: 'R58M123ABC', approve: true });
  });
});

describe('AgentEngine.intentAdbRunLive — mit Träger', () => {
  it('zeigt den echten Exit-Code, Träger und argv', async () => {
    stubBackend({
      adbRun: {
        status: 200,
        body: {
          ok: true, verb: 'logcat', serial: 'R58M123ABC',
          argv: ['adb', '-s', 'R58M123ABC', 'logcat', '-d', '-t', '200'],
          carrier: { kind: 'local', name: 'adb' }, exitCode: 0,
          output: '01-01 00:00:00 I System: start', truncated: false,
          durationMs: 34, reason: 'exit-code',
        },
      },
    });
    const engine = new AgentEngine('service-1');
    const text = await engine.intentAdbRunLive(parseAdbCommand('adb -s R58M123ABC logcat lines=200')!);
    expect(text).toContain('Exit-Code 0');
    expect(text).toContain('Träger: local (adb)');
    expect(text).toContain('logcat -d -t 200');
    expect(text).toContain('adb_run');
  });

  it('meldet Fehler-Exit-Code statt Erfolg', async () => {
    stubBackend({
      adbRun: {
        status: 200,
        body: {
          ok: false, verb: 'shell', serial: 'X', argv: ['adb', '-s', 'X', 'shell', 'getprop'],
          carrier: { kind: 'remote', name: 'desktop-werkstatt' }, exitCode: 1,
          output: "adb: device 'X' not found", truncated: false, durationMs: 9,
          reason: 'exit-code-fehler',
        },
      },
    });
    const engine = new AgentEngine('service-1');
    const text = await engine.intentAdbRunLive(parseAdbCommand('adb -s X shell getprop')!);
    expect(text).toContain('Exit-Code 1');
    expect(text).toContain('desktop-werkstatt');
    expect(text).not.toContain('✅');
  });

  it('Risiko-Verb: erst Plan, nach „freigeben“ echte Ausführung mit approve', async () => {
    const state = stubBackend({
      adbRun: {
        status: 200,
        body: {
          ok: true, verb: 'reboot', serial: 'R58M123ABC', argv: ['adb', '-s', 'R58M123ABC', 'reboot'],
          carrier: { kind: 'local', name: 'adb' }, exitCode: 0, output: 'rebooting…',
          truncated: false, durationMs: 20, reason: 'exit-code',
        },
      },
    });
    const engine = new AgentEngine('service-1');
    const plan = await engine.ask('adb -s R58M123ABC reboot bootloader');
    expect(plan).toContain('Risiko-Verb');
    expect(plan).toContain('freigeben');
    expect(state.calls.some((c) => c.url.includes('/api/adb/run'))).toBe(false);

    const run = await engine.ask('freigeben');
    expect(run).toContain('Freigabe erteilt');
    expect(run).toContain('Exit-Code 0');
    const call = state.calls.find((c) => c.url.includes('/api/adb/run'));
    expect(call?.body).toMatchObject({ verb: 'reboot', serial: 'R58M123ABC', approve: true });
  });

  it('ask() führt adb-Kommandos über das Backend aus', async () => {
    const state = stubBackend();
    const engine = new AgentEngine('service-1');
    const text = await engine.ask('adb devices');
    expect(text).toContain('Exit-Code 0');
    expect(state.calls.some((c) => c.url.includes('/api/adb/run'))).toBe(true);
  });
});

describe('AgentEngine.intentAdbRunLive — ohne Träger bleibt Plan + Skript', () => {
  const noCarrier = {
    adbRun: {
      status: 501,
      body: {
        type: 'error', code: 'KEIN_ADB_TRAEGER',
        message: 'Kein ADB-Träger registriert: weder ein adb-Binary auf dem Backend-Host '
          + '(NEXUS_ADB=/pfad/zum/adb) noch ein freigegebener entfernter Träger '
          + '(NEXUS_ADB_REMOTE=1). Die Web-Seite bleibt deshalb beim Plan + Skript.',
      },
    },
  };

  it('nennt 501, den Ausweg und liefert das ausführbare Skript', async () => {
    stubBackend(noCarrier);
    const engine = new AgentEngine('service-1');
    const text = await engine.intentAdbRunLive(parseAdbCommand('adb -s R58M123ABC logcat lines=50')!);
    expect(text).toContain('Kein ADB-Träger');
    expect(text).toContain('KEIN_ADB_TRAEGER');
    expect(text).toContain('NEXUS_ADB');
    expect(text).toContain('Skript erstellt');
    expect(text).toContain('#!/usr/bin/env bash');
    expect(text).not.toContain('Exit-Code 0');
  });

  it('erfindet ohne Träger keine Geräte und keinen Exit-Code', async () => {
    stubBackend(noCarrier);
    const engine = new AgentEngine('service-1');
    const text = await engine.ask('adb devices');
    expect(text).toContain('nicht** ausgeführt');
    expect(text).toContain('adb devices -l');
    expect(text).not.toMatch(/Exit-Code \d/);
    expect(text).not.toContain('R58M123ABC   device');
  });

  it('RBAC-Ablehnung wird als solche gemeldet', async () => {
    stubBackend({
      adbRun: {
        status: 403,
        body: { type: 'error', code: 'RBAC_DENIED', message: 'Rolle operator darf adb.run nicht' },
      },
    });
    const engine = new AgentEngine('operator');
    const text = await engine.intentAdbRunLive(parseAdbCommand('adb devices')!);
    expect(text).toContain('abgelehnt');
    expect(text).toContain('RBAC_DENIED');
    expect(text).toContain('service');
  });

  it('Backend offline: ehrliche Meldung mit lokalem Befehl', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline (test-isoliert)');
    }));
    const engine = new AgentEngine('service-1');
    const text = await engine.intentAdbRunLive(parseAdbCommand('adb connect 192.168.1.20:5555')!);
    expect(text).toContain('nicht ausgeführt');
    expect(text).toContain('adb connect 192.168.1.20:5555');
    expect(text).toContain('/api/adb/status');
  });
});
