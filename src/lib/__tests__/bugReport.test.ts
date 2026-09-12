/**
 * Tests für Phase-5-Fehlerfalle (Banner + Bericht). Ausführen: npm test
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { buildBugReport, bugEntries, installGlobalHandlers } from '../bugReport';

beforeEach(() => {
  // Über den echten Schließen-Pfad (setzt auch das Anzeige-Flag zurück).
  const banner = document.getElementById('dgs-bug-banner');
  const close = [...(banner?.querySelectorAll('button') ?? [])].find((b) =>
    b.textContent?.includes('Schließen'),
  );
  if (close) close.click();
  else banner?.remove();
});

describe('bugReport', () => {
  it('fängt window-Fehler, zeigt Banner und baut Bericht', () => {
    installGlobalHandlers();
    const before = bugEntries().length;
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'test-boom', filename: 'test.ts', lineno: 1 }),
    );
    expect(bugEntries().length).toBe(before + 1);
    expect(bugEntries()[bugEntries().length - 1].message).toContain('test-boom');
    const banner = document.getElementById('dgs-bug-banner');
    expect(banner?.textContent).toContain('Fehlerbericht laden');
    const report = buildBugReport();
    expect(report.app).toBe('dingelschwinng-moe-agent');
    expect(Array.isArray(report.errors)).toBe(true);
  });

  it('fängt unbehandelte Promise-Rejections', () => {
    installGlobalHandlers();
    const before = bugEntries().length;
    // happy-dom kennt PromiseRejectionEvent nicht – der Handler liest nur `reason`.
    const evt = new Event('unhandledrejection');
    (evt as unknown as Record<string, unknown>).reason = new Error('rej-boom');
    window.dispatchEvent(evt);
    expect(bugEntries().length).toBe(before + 1);
    expect(bugEntries()[bugEntries().length - 1].kind).toBe('rejection');
  });

  it('Banner-Schließen entfernt nur das Banner, Einträge bleiben', () => {
    installGlobalHandlers();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom-2' }));
    const banner = document.getElementById('dgs-bug-banner');
    expect(banner).not.toBeNull();
    const close = [...(banner?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent?.includes('Schließen'),
    );
    close?.click();
    expect(document.getElementById('dgs-bug-banner')).toBeNull();
    expect(bugEntries().length).toBeGreaterThan(0);
  });
});
