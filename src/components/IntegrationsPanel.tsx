import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { apiUrl, describeEndpoint, getEndpoint } from '../lib/endpoint';
import { listCatalogue } from '../lib/grabber';
import { pingBase } from '../lib/portview';
import {
  bundledVendorCount,
  fetchAdbDevices,
  fetchUsbHostDevices,
  fetchVendorSnapshot,
  formatPreflightReport,
  lookupVendor,
  runPreflight,
  searchBundledVendors,
  type AdbDevice,
  type PreflightReport,
  type UsbHostSnapshot,
  type VendorSnapshot,
} from '../lib/vendors';
import { Mono, PanelSection, PanelShell, Pill, StatTile, useAsyncPoll } from './panels/ui';

/**
 * Anbindungen – eine Ansicht für alles, was mit diesem Client verbunden ist oder
 * werden kann: Server/Ports, ADB- und USB-Geräte mit Hersteller-Namen, die
 * kuratierte VID-Tabelle, Import-Bibliotheken, Speicherorte und die
 * schreibgeschützte Vorabprüfung vor einem Eingriff.
 *
 * Bewusst nicht hier: Bootloader-Unlock, Flashen, FRP-Bypass, IMEI-Eingriffe.
 * Das sind keine App-Funktionen, sondern Herstellertools mit Eigentumsnachweis.
 */
interface GatewayStatus {
  ok?: boolean;
  product?: string;
  version?: string;
  hostname?: string;
  uptime_s?: number;
  ports?: { http?: number; tcp?: number; bridge?: number; discovery?: number };
  portview?: { ips?: string[]; udp_discovery?: boolean; discovery?: { answers?: number } };
  metrics?: Record<string, number>;
  whitelist?: { count?: number; active?: number; locked?: number };
  agent_auth?: { enforced?: boolean; mode?: string };
  connected_agents?: number;
  simulated_token?: boolean;
  usb?: { ok?: boolean; vendors?: number; bundled?: number; sources?: string[]; adb?: string | null; note?: string };
  stores?: { stores?: Array<{ name?: string; path?: string; bytes?: number; exists?: boolean; files?: number; entries?: number; kind?: string; note?: string }> };
  usb_vendors?: number;
}

interface Catalogue {
  ok: boolean;
  stats?: Record<string, unknown> & { count?: number; bytes?: number; dir?: string; by_category?: Record<string, number> };
  assets?: unknown[];
  error?: string;
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info'> = {
  ok: 'ok',
  attention: 'warn',
  blockiert: 'bad',
};

const CHECK_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info'> = {
  ok: 'ok',
  warn: 'warn',
  bad: 'bad',
  info: 'info',
};

function IntegrationsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const endpoint = getEndpoint();
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [devices, setDevices] = useState<AdbDevice[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [usbHost, setUsbHost] = useState<UsbHostSnapshot | null>(null);
  const [vendors, setVendors] = useState<VendorSnapshot | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [query, setQuery] = useState('');
  const [serial, setSerial] = useState('');
  const [model, setModel] = useState('');
  const [image, setImage] = useState('');
  const [backupDir, setBackupDir] = useState('');
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [busy, setBusy] = useState<'' | 'load' | 'preflight'>('');
  const [note, setNote] = useState('');
  const [ping, setPing] = useState('');

  const refresh = useCallback(async () => {
    setBusy('load');
    setNote('');
    const [st, adb, usb, cat, ven] = await Promise.allSettled([
      fetch(apiUrl('/gateway/status'), { cache: 'no-store', signal: AbortSignal.timeout(4000) }).then(async (res) => (await res.json()) as GatewayStatus),
      fetchAdbDevices(),
      fetchUsbHostDevices(),
      listCatalogue(),
      fetchVendorSnapshot(),
    ]);
    setStatus(st.status === 'fulfilled' ? st.value : null);
    if (adb.status === 'fulfilled') {
      setDevices(adb.value.devices ?? []);
      setDeviceError(adb.value.ok ? '' : `${adb.value.error ?? 'adb_fehler'} · ${adb.value.hint ?? ''}`.trim());
    } else {
      setDevices([]);
      setDeviceError(String(adb.reason instanceof Error ? adb.reason.message : adb.reason));
    }
    setUsbHost(usb.status === 'fulfilled' ? usb.value : null);
    setCatalogue(cat.status === 'fulfilled' ? (cat.value as Catalogue) : null);
    setVendors(ven.status === 'fulfilled' ? ven.value : null);
    setBusy('');
  }, []);

  useAsyncPoll(refresh, 30000, true);

  const localHits = useMemo(() => searchBundledVendors(query), [query]);
  const direct = useMemo(() => lookupVendor(query), [query]);

  const startPreflight = useCallback(async () => {
    setBusy('preflight');
    setNote('');
    try {
      const result = await runPreflight({ serial: serial.trim(), model: model.trim(), image: image.trim(), backupDir: backupDir.trim() });
      setReport(result);
    } catch (exc) {
      setReport(null);
      setNote(t('panels.integrations.preflightFailed', 'Vorabprüfung nicht erreichbar') + `: ${exc instanceof Error ? exc.message : String(exc)}`);
    } finally {
      setBusy('');
    }
  }, [serial, model, image, backupDir, t]);

  const doPing = useCallback(async () => {
    const base = endpoint.gatewayBase || apiUrl('/gateway/status').replace(/\/gateway\/status$/, '');
    setPing('…');
    const result = await pingBase(base, '/status');
    setPing(result.ok ? `${result.latencyMs ?? '?'} ms` : t('panels.integrations.pingFailed', 'keine Antwort'));
  }, [endpoint.gatewayBase, t]);

  const stats = catalogue?.stats ?? {};
  const byCategory = (stats.by_category ?? {}) as Record<string, number>;
  const stores = status?.stores?.stores ?? [];
  const metrics = status?.metrics ?? {};
  const verdict = report?.verdict ?? '';

  return (
    <PanelShell
      emoji="🔗"
      title={t('panels.integrations.title', 'Anbindungen')}
      subtitle={describeEndpoint(endpoint)}
      onClose={onClose}
      onRefresh={() => void refresh()}
      busy={busy === 'load'}
    >
      <PanelSection title={t('panels.integrations.server', 'Server & Ports')} right={<Pill tone={status?.ok ? 'ok' : 'warn'}>{status?.ok ? t('panels.integrations.reachable', 'erreichbar') : t('panels.integrations.unreachable', 'außer Reichweite')}</Pill>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatTile label={t('panels.integrations.service', 'Dienst')} value={<span className="text-sm">{status?.product ?? '—'}</span>} hint={status?.version ? `v${status.version}` : t('panels.integrations.noReply', 'keine Antwort vom Gateway')} />
          <StatTile label={t('panels.integrations.host', 'Host')} value={<span className="text-sm">{status?.hostname ?? endpoint.host ?? '—'}</span>} hint={(status?.portview?.ips ?? []).slice(0, 3).join(' · ') || '—'} />
          <StatTile label="HTTP / TCP" value={<span className="text-sm">{status?.ports?.http ?? '—'} / {status?.ports?.tcp ?? '—'}</span>} hint={`UDP ${status?.ports?.discovery ?? '—'} · Bridge ${status?.ports?.bridge ?? '—'}`} />
          <StatTile label={t('panels.integrations.latency', 'Latenz')} value={<span className="text-sm">{ping || '—'}</span>} hint={status?.uptime_s ? `uptime ${Math.round(status.uptime_s)} s` : '—'} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void doPing()} className="px-3 py-1.5 rounded-full text-[11px] font-extrabold bg-white/10 ring-1 ring-white/15 hover:bg-white/15">
            {t('panels.integrations.ping', 'Ping')}
          </button>
          <Pill tone="slate">{`${t('panels.integrations.agents', 'Agenten')}: ${status?.connected_agents ?? 0}`}</Pill>
          <Pill tone={status?.portview?.udp_discovery ? 'ok' : 'slate'}>{`PortView UDP ${status?.portview?.discovery?.answers ?? 0} ×`}</Pill>
          {status?.simulated_token && <Pill tone="info">{t('panels.integrations.mock', 'Mock-Gateway')}</Pill>}
          {endpoint.source === 'native' && <Pill tone="ok">{t('panels.integrations.viaNative', 'Port nativ gefunden')}</Pill>}
        </div>
      </PanelSection>

      <PanelSection title={t('panels.integrations.devices', 'Angeschlossene Geräte')} right={<Pill tone={deviceError ? 'warn' : 'ok'}>{devices.length} × adb</Pill>}>
        {deviceError && (
          <p className="text-[11px] font-semibold text-amber-200/90 mb-2">
            {t('panels.integrations.adbMissing', 'adb meldet nichts')}: <Mono>{deviceError}</Mono> – {t('panels.integrations.adbMissingHint', 'adb läuft auf der Wartungsstation, nicht im Handy; das Gateway reicht die Geräte durch.')}
          </p>
        )}
        {devices.length === 0 && !deviceError && <p className="text-[11px] text-slate-400 font-semibold">{t('panels.integrations.noDevices', 'Kein Gerät über adb gemeldet.')}</p>}
        {devices.length > 0 && (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-[11px] font-bold">
              <thead className="text-slate-400">
                <tr>
                  {t('panels.integrations.deviceCols', 'Gerät|Zustand|Modell|Hersteller|Weg').split('|').map((head) => (
                    <th key={head} className="text-left font-black px-1 py-1 whitespace-nowrap">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devices.map((dev) => (
                  <tr key={dev.serial} className="border-t border-white/10 align-top">
                    <td className="px-1 py-1"><Mono>{dev.serial}</Mono></td>
                    <td className="px-1 py-1"><Pill tone={dev.state === 'device' ? 'ok' : dev.state === 'unauthorized' ? 'warn' : 'bad'}>{dev.state}</Pill></td>
                    <td className="px-1 py-1 text-slate-200">{dev.model ?? dev.product ?? '—'}</td>
                    <td className="px-1 py-1 text-slate-200">{dev.manufacturer_adb || dev.manufacturer_usb || '—'}</td>
                    <td className="px-1 py-1 text-slate-400">{dev.transport ?? 'usb'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(usbHost?.devices?.length ?? 0) > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">{t('panels.integrations.usbHost', 'USB-Geräte am Host (lsusb)')}</p>
            <div className="flex flex-wrap gap-1.5">
              {(usbHost?.devices ?? []).map((item) => (
                <Pill key={`${item.vid}:${item.pid}`} tone={item.known ? 'info' : 'slate'}>{`${item.vid}:${item.pid} · ${item.manufacturer ?? item.name}`}</Pill>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {devices.map((dev) => (
            <button key={`pick-${dev.serial}`} type="button" onClick={() => setSerial(dev.serial)} className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-white/5 ring-1 ring-white/10 hover:bg-white/10">
              {t('panels.integrations.useDevice', 'für Vorabprüfung')}: {dev.serial}
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title={t('panels.integrations.preflight', 'Vorabprüfung · Brickschutz')}
        right={<Pill tone="info">{t('panels.integrations.readOnly', 'nur lesend')}</Pill>}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
          {[
            { key: 'serial', label: t('panels.integrations.fieldSerial', 'Seriennummer'), value: serial, set: setSerial, placeholder: 'CT45P-0001' },
            { key: 'model', label: t('panels.integrations.fieldModel', 'Erwartetes Modell'), value: model, set: setModel, placeholder: 'CT45' },
            { key: 'image', label: t('panels.integrations.fieldImage', 'Image (im freigegebenen Ordner)'), value: image, set: setImage, placeholder: 'rom-ct45.zip' },
            { key: 'backup', label: t('panels.integrations.fieldBackup', 'Backup-Ordner'), value: backupDir, set: setBackupDir, placeholder: '/srv/backups' },
          ].map((field) => (
            <label key={field.key} className="block">
              <span className="block text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1">{field.label}</span>
              <input
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                placeholder={field.placeholder}
                className="w-full px-2.5 py-1.5 rounded-xl bg-black/40 ring-1 ring-white/15 text-[12px] font-mono text-white placeholder:text-slate-500"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button
            type="button"
            onClick={() => void startPreflight()}
            disabled={busy !== ''}
            className="px-3.5 py-1.5 rounded-full text-[11px] font-extrabold bg-gradient-to-br from-cyan-600 to-sky-700 text-white ring-1 ring-cyan-300/40 hover:brightness-110 disabled:opacity-50"
          >
            {busy === 'preflight' ? t('panels.integrations.checking', 'prüfe …') : t('panels.integrations.startCheck', 'Prüfung starten')}
          </button>
          {verdict && <Pill tone={STATUS_TONE[verdict] ?? 'slate'}>{t(`panels.integrations.verdict.${verdict}`, verdict)}</Pill>}
          {report?.adb === null && <Pill tone="warn">{t('panels.integrations.noAdb', 'adb auf diesem Host nicht verfügbar')}</Pill>}
          {report && <span className="text-[10px] font-mono text-slate-400 truncate max-w-[46ch]">{formatPreflightReport(report).split('\n')[0]}</span>}
        </div>
        {note && <p className="text-[11px] font-bold text-rose-200/90 mb-2">{note}</p>}
        {(report?.checks?.length ?? 0) > 0 && (
          <ul className="space-y-1.5">
            {(report?.checks ?? []).map((check) => (
              <li key={check.id} className="rounded-xl bg-white/5 ring-1 ring-white/10 px-2.5 py-2">
                <div className="flex items-start gap-2">
                  <Pill tone={CHECK_TONE[check.status] ?? 'slate'}>{check.status}</Pill>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-white">{check.label}</p>
                    <p className="text-[11px] font-semibold text-slate-300">{check.detail}</p>
                    {check.command && <p className="text-[10px] font-mono text-slate-400 mt-0.5 break-all">$ {check.command}</p>}
                    {check.fix && <p className="text-[10px] font-semibold text-amber-200/80 mt-0.5">{check.fix}</p>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10px] font-semibold text-slate-400 leading-relaxed">
          {t('panels.integrations.preflightNote', 'Die Prüfung liest Akkustand, Bootloader-Status, Patch-Alter und Prüfsummen. Entsperren, Flashen, FRP-Bypass und IMEI-Eingriffe sind bewusst nicht implementiert – sie gehören in OEM-Werkzeuge mit Eigentumsnachweis.')}
        </p>
      </PanelSection>

      <PanelSection title={t('panels.integrations.vendors', 'Hersteller (USB VID → Name)')} right={<Pill tone="slate">{`${vendors?.count ?? bundledVendorCount} ×`}</Pill>}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('panels.integrations.vendorPlaceholder', 'VID, 18d1:4e12 oder Herstellername')}
          className="w-full px-3 py-2 rounded-xl bg-black/40 ring-1 ring-white/15 text-[12px] font-mono text-white placeholder:text-slate-500 mb-2"
        />
        {direct && (
          <p className="text-[11px] font-bold text-cyan-200 mb-2">
            <Mono>{`${direct.vid}${direct.pid ? `:${direct.pid}` : ''}`}</Mono> → {direct.name} · {direct.kind_label}
            {direct.note ? ` · ${direct.note}` : ''}
          </p>
        )}
        {query && localHits.length === 0 && <p className="text-[11px] font-semibold text-slate-400">{t('panels.integrations.vendorNone', 'In der Kern-Tabelle nicht gefunden.')}</p>}
        {!query && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {(vendors?.sources ?? []).map((src) => (
              <Pill key={src} tone="info">{src}</Pill>
            ))}
          </div>
        )}
        {(query ? localHits : (vendors?.vendors ?? []).slice(0, 12)).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
            {(query ? localHits : (vendors?.vendors ?? []).slice(0, 12)).map((row) => (
              <div key={row.vid} className="flex items-baseline gap-2 rounded-lg bg-white/5 ring-1 ring-white/10 px-2 py-1.5">
                <Mono className="text-cyan-200">{row.vid}</Mono>
                <span className="text-[11px] font-bold text-slate-200 truncate">{row.name}</span>
                {row.adb && <Pill tone="ok">adb</Pill>}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] font-semibold text-slate-400 leading-relaxed">
          {t('panels.integrations.vendorNote', 'Kern-Tabelle aus der Android-Doku; für die vollständige Liste startet man das Gateway mit --usb-ids /usr/share/hwdata/usb.ids – dann gewinnt die Host-Tabelle.')}
        </p>
      </PanelSection>

      <PanelSection title={t('panels.integrations.stores', 'Bibliotheken, Datenbanken & Speicher')}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <StatTile label={t('panels.integrations.assets', 'Import-Katalog')} value={<span className="text-sm">{stats.count ?? 0}</span>} hint={`${stats.bytes ?? 0} B`} />
          <StatTile label={t('panels.integrations.tokens', 'Token (Whitelist)')} value={<span className="text-sm">{status?.whitelist?.active ?? 0}/{status?.whitelist?.count ?? 0}</span>} hint={`${status?.whitelist?.locked ?? 0} ${t('panels.integrations.locked', 'gesperrt')}`} />
          <StatTile label="Grants / Denies" value={<span className="text-sm">{metrics.grants ?? 0}/{metrics.denies ?? 0}</span>} hint={status?.agent_auth?.enforced ? t('panels.integrations.proofOn', 'Nachweis erzwungen') : t('panels.integrations.proofOff', 'Nachweis offen')} />
          <StatTile label={t('panels.integrations.imports', 'Abrufe / Fehler')} value={<span className="text-sm">{metrics.imports ?? 0}/{metrics.import_errors ?? 0}</span>} hint={`${metrics.import_bytes ?? 0} B`} />
        </div>
        {Object.keys(byCategory).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {Object.entries(byCategory).map(([cat, count]) => (
              <Pill key={cat} tone="slate">{`${cat} ${count}`}</Pill>
            ))}
          </div>
        )}
        {stores.length > 0 && (
          <ul className="space-y-1">
            {stores.map((row) => (
              <li key={row.name ?? row.path} className="flex flex-wrap items-baseline gap-2 text-[11px]">
                <Pill tone={row.exists === false ? 'warn' : 'ok'}>{row.name}</Pill>
                <Mono className="text-slate-300 break-all">{row.path ?? '—'}</Mono>
                <span className="text-slate-400 font-semibold">
                  {row.kind === 'ordner' ? `${row.files ?? 0} ${t('panels.integrations.files', 'Dateien')}` : `${row.bytes ?? 0} B`}
                  {row.entries ? ` · ${row.entries} Assets` : ''}
                  {row.exists === false ? ` · ${t('panels.integrations.notYet', 'noch nicht angelegt')}` : ''}
                </span>
                {row.note && <span className="text-slate-500 font-semibold">{row.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
    </PanelShell>
  );
}

export default IntegrationsPanel;
