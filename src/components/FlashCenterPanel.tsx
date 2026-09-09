import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  deviceControl,
  type DeviceProfileLite,
  type PortEntry,
  type PreFlashResult,
  type RomLite,
  type WizardStep,
} from '../lib/deviceControl';
import { PanelSection, PanelShell, Pill, StatTile } from './panels/ui';

/**
 * Flash-Center – gerätespezifisches Custom-OS-Flashing mit Brick-Schutz.
 *
 * Vereint die nativen Bausteine des Device-Control-Subsystems in einer
 * geführten Oberfläche:
 *
 *   1. Gerät + ROM wählen (aus der realen ROM-/Geräteprofil-Datenbank)
 *   2. Brick-Schutz-Report (Anti-Rollback/ARB, Firmware, Bootloader)
 *   3. Pre-Flash-Check (6 Punkte) – blockiert bei Risiko
 *   4. 5-Schritte-Assistent (Vorbereitung → Unlock → Recovery → Flash → Abschluss)
 *      inkl. ausdrücklicher Bestätigung + Backup-Checkliste
 *
 * Rechtlicher Hinweis wird prominent angezeigt: nur für eigene Geräte;
 * IMEI-Reparatur & FRP-Bypass sind bewusst NICHT enthalten.
 */

interface LogLine {
  ts: number;
  kind: 'info' | 'ok' | 'warn' | 'err';
  text: string;
}

function FlashCenterPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const native = deviceControl.isNative();

  const [profiles, setProfiles] = useState<DeviceProfileLite[]>([]);
  const [roms, setRoms] = useState<RomLite[]>([]);
  const [devices, setDevices] = useState<PortEntry[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [steps, setSteps] = useState<WizardStep[]>([]);

  const [serial, setSerial] = useState<string>('');
  const [profileId, setProfileId] = useState<string>('');
  const [romId, setRomId] = useState<string>('');
  const [romPath, setRomPath] = useState<string>('');
  const [sha256, setSha256] = useState<string>('');
  const [targetArb, setTargetArb] = useState<string>('');

  const [arbReport, setArbReport] = useState<string>('');
  const [preFlash, setPreFlash] = useState<PreFlashResult | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [busy, setBusy] = useState<string>('');
  const [log, setLog] = useState<LogLine[]>([]);

  const addLog = useCallback((kind: LogLine['kind'], text: string) => {
    setLog((l) => [...l, { ts: Date.now(), kind, text }].slice(-200));
  }, []);

  const loadCatalog = useCallback(async () => {
    setBusy('catalog');
    try {
      const [p, r, cl, st, pv] = await Promise.all([
        deviceControl.deviceProfiles(),
        deviceControl.romList(),
        deviceControl.backupChecklist(),
        deviceControl.wizardSteps(),
        deviceControl.portView().catch(() => ({ devices: [] as PortEntry[] })),
      ]);
      setProfiles(p.profiles ?? []);
      setRoms(r.roms ?? []);
      setChecklist(cl.checklist ?? []);
      setSteps(st.steps ?? []);
      setDevices(pv.devices ?? []);
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const profile = useMemo(() => profiles.find((p) => p.id === profileId) ?? null, [profiles, profileId]);
  const romMap = useMemo(() => new Map(roms.map((r) => [r.id, r])), [roms]);
  const compatibleRoms = useMemo(
    () => (profile ? profile.roms.map((id) => romMap.get(id)).filter((r): r is RomLite => Boolean(r)) : roms),
    [profile, romMap, roms],
  );

  const runArb = useCallback(async () => {
    setBusy('arb');
    try {
      const res = await deviceControl.arbReport(serial || undefined);
      setArbReport(res.report);
      addLog('info', 'ARB-/Brick-Schutz-Report gelesen.');
    } finally {
      setBusy('');
    }
  }, [serial, addLog]);

  const runPreFlash = useCallback(async () => {
    setBusy('preflash');
    setPreFlash(null);
    try {
      const res = await deviceControl.preFlashCheck({
        serial: serial || undefined,
        profileId: profileId || undefined,
        romPath: romPath || undefined,
        sha256: sha256 || undefined,
        targetArb: targetArb || undefined,
      });
      setPreFlash(res);
      addLog(res.safe ? 'ok' : 'err', res.safe ? 'Pre-Flash-Check bestanden.' : `Pre-Flash-Check blockiert (${res.errors.length} Fehler).`);
    } finally {
      setBusy('');
    }
  }, [serial, profileId, romPath, sha256, targetArb, addLog]);

  const runStep = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        if (id === 'prepare') {
          const res = await deviceControl.wizardPrepare(serial || undefined);
          addLog('info', res.output);
        } else if (id === 'unlock') {
          if (!confirmWipe) {
            addLog('warn', 'Unlock abgebrochen: Datenverlust-Bestätigung fehlt.');
            return;
          }
          if (!preFlash?.safe) {
            addLog('err', 'Unlock blockiert: Erst muss der Pre-Flash-Check bestanden werden.');
            return;
          }
          const res = await deviceControl.wizardUnlock(serial || undefined, true);
          res.log.forEach((l) => addLog(res.success ? 'ok' : 'err', l));
        } else if (id === 'finish') {
          const res = await deviceControl.wizardFinish(serial || undefined);
          res.log.forEach((l) => addLog(res.success ? 'ok' : 'err', l));
        } else {
          addLog('warn', `Schritt „${id}" wird in der App über den nativen Assistenten ausgeführt.`);
        }
      } finally {
        setBusy('');
      }
    },
    [serial, confirmWipe, preFlash, addLog],
  );

  const logTone: Record<LogLine['kind'], string> = {
    info: 'text-slate-300',
    ok: 'text-emerald-300',
    warn: 'text-amber-300',
    err: 'text-rose-300',
  };

  return (
    <PanelShell
      emoji="🚀"
      title={t('panels.flashcenter.title', 'Flash-Center · Custom-OS')}
      subtitle={t('panels.flashcenter.subtitle', 'Gerätespezifisches Flashing · Brick-Schutz · Einrichtung · Konfiguration')}
      onClose={onClose}
      onRefresh={() => void loadCatalog()}
      busy={busy === 'catalog'}
      width="max-w-5xl"
    >
      <div className="mb-4 rounded-2xl border border-rose-700/40 bg-rose-950/40 p-3 text-[11px] text-rose-100">
        ⚠️ <strong>{t('panels.flashcenter.legalTitle', 'Nur für eigene Geräte.')}</strong>{' '}
        {t('panels.flashcenter.legal', 'Bootloader-Unlock & Custom-ROM-Flashing können Garantie kosten und ALLE Daten löschen. IMEI-Reparatur und FRP-Bypass sind bewusst NICHT enthalten (in der EU/DE illegal bzw. umgeht Diebstahlschutz).')}
      </div>

      {!native && (
        <div className="mb-4 rounded-2xl border border-amber-700/40 bg-amber-950/40 p-3 text-[11px] text-amber-200">
          🌐 {t('panels.flashcenter.webNote', 'Browser-Vorschau: Katalog (ROMs, Geräteprofile, Assistent) stammt aus den realen App-Datenbanken. Flash-, Unlock- und Check-Aktionen laufen ausschließlich in der installierten App mit angeschlossenem Gerät.')}
        </div>
      )}

      {/* Schritt 1: Auswahl */}
      <PanelSection title={t('panels.flashcenter.select', '1 · Gerät & Custom-OS wählen')}>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Zielgerät (Serial)</span>
            <select
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white"
            >
              <option value="">— manuell / kein Live-Gerät —</option>
              {devices.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {d.label || d.serial} ({d.state})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Geräteprofil (Codename)</span>
            <select
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setRomId('');
              }}
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white"
            >
              <option value="">— Profil wählen —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.brand ? `${p.brand} · ` : ''}{p.model}{p.codename ? ` (${p.codename})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Custom-OS</span>
            <select
              value={romId}
              onChange={(e) => setRomId(e.target.value)}
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white"
            >
              <option value="">— ROM wählen —</option>
              {compatibleRoms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">ROM-Datei (Pfad auf Gerät)</span>
            <input
              value={romPath}
              onChange={(e) => setRomPath(e.target.value)}
              placeholder="/sdcard/rom.zip"
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white font-mono"
            />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">SHA-256 (Soll, optional)</span>
            <input
              value={sha256}
              onChange={(e) => setSha256(e.target.value)}
              placeholder="Prüfsumme zur Integritätsprüfung"
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white font-mono"
            />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Ziel-ARB-Version (optional)</span>
            <input
              value={targetArb}
              onChange={(e) => setTargetArb(e.target.value)}
              placeholder="z. B. 4"
              className="mt-1 w-full rounded-lg bg-[#050a18] border border-white/10 px-2 py-1.5 text-xs text-white font-mono"
            />
          </label>
        </div>

        {profile && (
          <div className="mt-3 rounded-xl border border-white/8 bg-[#050a18]/70 p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <StatTile label="Flash-Methode" value={profile.flashMethod} />
              <StatTile label="Unlock nötig" value={profile.unlockRequired ? 'ja' : 'nein'} tone={profile.unlockRequired ? 'text-amber-300' : 'text-emerald-300'} />
              <StatTile label="Partitionen" value={profile.partitions.length} hint={profile.partitions.join(', ')} />
              <StatTile label="ROMs" value={profile.roms.length} />
            </div>
            {profile.arbWarning && (
              <div className="mt-2 rounded-lg border border-amber-700/40 bg-amber-950/40 p-2 text-[11px] text-amber-200">
                ⚠️ {profile.arbWarning}
              </div>
            )}
            {romId && romMap.get(romId)?.website && (
              <div className="mt-2 text-[11px] text-slate-400">
                {romMap.get(romId)?.description}{' '}
                <a href={romMap.get(romId)?.website} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
                  {romMap.get(romId)?.website}
                </a>
              </div>
            )}
          </div>
        )}
      </PanelSection>

      {/* Schritt 2: Brick-Schutz */}
      <PanelSection
        title={t('panels.flashcenter.brick', '2 · Brick-Schutz (Anti-Rollback / eFuse)')}
        className="mt-3"
        right={
          <button
            type="button"
            onClick={() => void runArb()}
            disabled={busy === 'arb'}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-40"
          >
            {busy === 'arb' ? '…' : '🔍 ARB prüfen'}
          </button>
        }
      >
        {arbReport ? (
          <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words">{arbReport}</pre>
        ) : (
          <p className="text-[11px] text-slate-400">
            {t('panels.flashcenter.brickHint', 'Liest ARB-Version, Firmware, Bootloader und Security-Patch. Ein Downgrade unter die aktuelle ARB-Version kann das Gerät dauerhaft unbrauchbar machen – der Pre-Flash-Check blockiert das.')}
          </p>
        )}
      </PanelSection>

      {/* Schritt 3: Pre-Flash-Check */}
      <PanelSection
        title={t('panels.flashcenter.preflash', '3 · Pre-Flash-Check (Brick-Schutz)')}
        className="mt-3"
        right={
          <button
            type="button"
            onClick={() => void runPreFlash()}
            disabled={busy === 'preflash'}
            className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition disabled:opacity-40"
          >
            {busy === 'preflash' ? '…' : '🛡️ Check ausführen'}
          </button>
        }
      >
        {preFlash ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Pill tone={preFlash.safe ? 'ok' : 'bad'}>{preFlash.safe ? '✅ Flash möglich' : '🛑 Flash blockiert'}</Pill>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-words">{preFlash.summary}</pre>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            {t('panels.flashcenter.preflashHint', 'Prüft: Gerät erreichbar · Bootloader entsperrt · ROM vorhanden & SHA-256 korrekt · ROM für Gerät freigegeben · ARB-Downgrade · Akku ≥ 60 %. Bei Fehlern wird der Flash blockiert.')}
          </p>
        )}
      </PanelSection>

      {/* Schritt 4: Assistent */}
      <PanelSection title={t('panels.flashcenter.wizard', '4 · Einrichtungs-Assistent')} className="mt-3">
        <label className="flex items-start gap-2 mb-3 rounded-lg border border-amber-700/40 bg-amber-950/30 p-2 cursor-pointer">
          <input type="checkbox" checked={confirmWipe} onChange={(e) => setConfirmWipe(e.target.checked)} className="mt-0.5" />
          <span className="text-[11px] text-amber-200">
            {t('panels.flashcenter.confirmWipe', 'Ich bestätige: Es ist mein eigenes Gerät, ein Backup existiert, und ich akzeptiere Datenverlust & möglichen Garantieverlust.')}
          </span>
        </label>

        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={s.id} className="rounded-xl border border-white/8 bg-[#050a18]/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-black text-white">
                    {i + 1}. {s.title}
                  </div>
                  <div className="text-[11px] text-slate-400">{s.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void runStep(s.id)}
                  disabled={busy === s.id || (s.id === 'unlock' && !confirmWipe)}
                  className="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition disabled:opacity-40"
                >
                  {busy === s.id ? '…' : t('panels.flashcenter.run', 'Ausführen')}
                </button>
              </div>
              {s.warning && <div className="mt-1.5 text-[10px] text-rose-300">{s.warning}</div>}
            </div>
          ))}
        </div>
      </PanelSection>

      {/* Backup-Checkliste + Log */}
      <div className="grid md:grid-cols-2 gap-3 mt-3">
        <PanelSection title={t('panels.flashcenter.backup', 'Backup-Checkliste (Pflicht)')}>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[11px] text-slate-300">
                <span className="text-emerald-400">☑</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </PanelSection>

        <PanelSection
          title={t('panels.flashcenter.log', 'Protokoll')}
          right={
            <button type="button" onClick={() => setLog([])} className="text-[10px] text-slate-400 hover:text-white">
              leeren
            </button>
          }
        >
          <div className="h-56 overflow-y-auto rounded-lg bg-black/40 border border-white/6 p-2 font-mono text-[10px] space-y-0.5">
            {log.length === 0 ? (
              <div className="text-slate-600">— noch keine Ausgabe —</div>
            ) : (
              log.map((l, i) => (
                <div key={i} className={logTone[l.kind]}>
                  <span className="text-slate-600">{new Date(l.ts).toLocaleTimeString()} </span>
                  {l.text}
                </div>
              ))
            )}
          </div>
        </PanelSection>
      </div>
    </PanelShell>
  );
}

export default FlashCenterPanel;
