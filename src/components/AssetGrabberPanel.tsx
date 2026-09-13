import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  applyStyle,
  appliedStyleInfo,
  clearAppliedStyle,
  clearLocalCache,
  contextBlock,
  deleteAsset,
  grabFromFile,
  grabFromUrl,
  importBackendInfo,
  listCatalogue,
  localStats,
  mediaUrlFor,
  prefetchOffline,
  textOfAsset,
  type ImportResponse,
} from '../lib/grabber'
import { formatIngestReport, ingestPage } from '../lib/pageIngest';
import { CATEGORIES, categoryInfo, detectCategory, filenameFromUrl, formatBytes, shortHash, type ImportedAsset, type PackCategory } from '../lib/packs';
import { Mono, PanelSection, PanelShell, Pill, StatTile, useAsyncPoll } from './panels/ui';

/**
 * Software-Grabber – URLs rein, Katalog raus.
 *
 * Der Grabber selbst läuft im Mobile-Server (`mobile-server/importer.py`): Limits,
 * SSRF-Filter, SHA-256-Dedupe und die Ablage unter `data/imports`. Diese Panel-Schicht
 * macht drei Dinge: Import anstoßen, Katalog anzeigen (Gateway + lokale Offline-Kopien),
 * und die Inhalte nutzbar machen – Audio abspielen, UI-Styles live anwenden,
 * Effekte/Filter als Text übernehmen.
 */
const AUDIO = new Set(['beats', 'samples']);
const TEXTUAL = new Set(['styles', 'effects', 'filters']);

interface Row {
  asset: ImportedAsset;
  mediaUrl?: string;
  text?: string | null;
  busy?: boolean;
  message?: string;
}

function AssetGrabberPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [urls, setUrls] = useState('');
  const [category, setCategory] = useState<PackCategory | ''>('');
  const [tags, setTags] = useState('');
  const [filter, setFilter] = useState<PackCategory | 'all'>('all');
  const [rows, setRows] = useState<Row[]>([]);
  const [imports, setImports] = useState<ImportResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cache, setCache] = useState({ count: 0, bytes: 0, available: true });
  const [style, setStyle] = useState<{ id: string; title?: string } | null>(null);
  const [pageUrl, setPageUrl] = useState('');
  const [pageBusy, setPageBusy] = useState(false);
  const [pageReport, setPageReport] = useState('');
  const backend = useMemo(() => importBackendInfo(), []);

  const reload = useCallback(async () => {
    const [list, stats] = await Promise.all([listCatalogue(filter === 'all' ? undefined : filter), localStats()]);
    const prepared = await Promise.all(
      list.assets.map(async (asset): Promise<Row> => ({
        asset,
        mediaUrl: AUDIO.has(asset.category) ? (await mediaUrlFor(asset)) ?? undefined : undefined,
      })),
    );
    setRows(prepared);
    setCache(stats);
  }, [filter]);

  const { busy: polling, refresh } = useAsyncPoll(async () => {
    if (!rows.length && !imports.length) await reload();
  }, 15_000);
  void polling;

  useEffect(() => {
    void reload();
    setStyle(appliedStyleInfo());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const patchRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.asset.id === id ? { ...row, ...patch } : row)));

  const runImport = useCallback(async () => {
    const list = urls
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (!list.length) {
      setImports([{ ok: false, via: 'gateway', imported: [], error: 'url_fehlt', hint: t('panels.grabber.needUrl', 'Bitte mindestens eine URL eintragen.') }]);
      return;
    }
    setBusy(true);
    const results: ImportResponse[] = [];
    for (const url of list) {
      results.push(
        await grabFromUrl(url, {
          category,
          tags: tags
            .split(/[,\s]+/)
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 8),
        }),
      );
    }
    setImports(results);
    setBusy(false);
    await reload();
  }, [urls, category, tags, reload, t]);

  /** A-7: Datei-Drop ohne Gateway — rein lokal in den IndexedDB-Asset-Store. */
  const runFileImport = useCallback(
    async (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []).slice(0, 8);
      if (!list.length) return;
      setBusy(true);
      const results: ImportResponse[] = [];
      for (const file of list) {
        results.push(
          await grabFromFile(file, {
            category,
            tags: tags
              .split(/[,\s]+/)
              .map((x) => x.trim())
              .filter(Boolean)
              .slice(0, 8),
          }),
        );
      }
      setImports(results);
      setBusy(false);
      await reload();
    },
    [category, tags, reload],
  );

  const runPage = useCallback(
    async (reviewOnly: boolean) => {
      const url = pageUrl.trim().split(/\s+/)[0] ?? '';
      if (!/^https?:\/\//i.test(url)) {
        setPageReport(t('panels.grabber.needPageUrl', 'Bitte eine http(s)-URL einer Seite eintragen.'));
        return;
      }
      setPageBusy(true);
      try {
        const result = await ingestPage(
          { url },
          { reviewOnly, toLibrary: !reviewOnly, importSoftware: !reviewOnly, toDeviceCache: !reviewOnly, tags: ['panel-ingest'] },
        );
        setPageReport(formatIngestReport(result));
        if (!reviewOnly) await reload();
      } catch (e) {
        setPageReport(`❌ ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      } finally {
        setPageBusy(false);
      }
    },
    [pageUrl, reload, t],
  );

  const preview = useCallback(async (row: Row) => {
    if (row.text) return patchRow(row.asset.id, { text: undefined });
    patchRow(row.asset.id, { busy: true });
    const text = await textOfAsset(row.asset);
    patchRow(row.asset.id, { busy: false, text: text ?? t('panels.grabber.noText', 'kein Text/keine Vorschau verfügbar') });
    return undefined;
  }, [t]);

  const detected = useMemo(() => {
    const first = urls.split(/\n+/).map((x) => x.trim()).filter(Boolean)[0] ?? '';
    if (!first) return null;
    const name = filenameFromUrl(first);
    const guess = detectCategory(name, '', first);
    return { name, ...guess };
  }, [urls]);

  return (
    <PanelShell
      title={t('panels.grabber.title', 'Grabber – Beat-, Sample-, Style-, Effekt- und Filter-Import')}
      subtitle={`${backend.gatewayBase}  ·  ${backend.native ? t('panels.grabber.native', 'nativ') : t('panels.grabber.pwa', 'PWA')}`}
      emoji="📥"
      onClose={onClose}
      onRefresh={() => void reload()}
      busy={busy}
    >
      <div className="space-y-4">
        <PanelSection title={t('panels.grabber.source', 'Quelle (URLs, eine pro Zeile)')}>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'https://files.meine-firma.de/packs/werkhof-4bar.wav\nhttps://files.meine-firma.de/packs/dark-ui.css\nhttps://files.meine-firma.de/packs/pack.json'}
            className="w-full rounded-xl bg-[#020617] border border-white/10 px-2.5 py-2 text-[12px] font-mono text-cyan-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
              {t('panels.grabber.category', 'Kategorie')}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as PackCategory | '')}
                className="block mt-1 rounded-lg bg-[#020617] border border-white/10 px-2 py-1.5 text-[12px] text-slate-200 focus:outline-none"
              >
                <option value="">{t('panels.grabber.auto', 'automatisch erkennen')}</option>
                {CATEGORIES.filter((c) => c.id !== 'other').map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-wide text-slate-500 font-bold flex-1 min-w-[140px]">
              {t('panels.grabber.tags', 'Schlagwörter')}
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="kick, halle-b, v1"
                className="mt-1 w-full rounded-lg bg-[#020617] border border-white/10 px-2 py-1.5 text-[12px] font-mono text-cyan-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const origin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1:5173';
                setUrls(`${origin}/demo/packs/dgs-demo-pack.json`);
                setCategory('');
                setTags('demo');
              }}
              title={t('panels.grabber.demoHint', 'Füllt das Feld mit dem Demo-Pack aus public/demo/packs/')}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-200 border border-white/10 transition"
            >
              {t('panels.grabber.demo', 'Demo-Pack laden')}
            </button>
            <button
              type="button"
              onClick={() => void runImport()}
              disabled={busy}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition disabled:opacity-40"
            >
              {busy ? t('panels.grabber.importing', 'importiere…') : t('panels.grabber.importBtn', 'Importieren')}
            </button>
          </div>
          {detected && (
            <p className="mt-2 text-[10px] font-mono text-slate-500">
              {t('panels.grabber.detects', 'Erkannt')}: {categoryInfo(detected.category).icon} {categoryInfo(detected.category).label}
              {detected.known ? ` (${t('panels.grabber.byExt', 'über Dateiendigung/MIME')})` : ` (${t('panels.grabber.byWords', 'aus dem Namen geraten')})`} · {detected.name}
            </p>
          )}
          <p className="mt-1 text-[10px] font-mono text-slate-500">
            {backend.configured
              ? t('panels.grabber.viaGateway', 'Import läuft über den Mobile-Server (64 MiB, interne Dateiserver erlaubt, SHA-256-Dedupe).')
              : t('panels.grabber.viaBrowser', 'Kein Gateway gefunden: Browser-Import (CORS-Limits, max 32 MiB). PortView im PortView-Panel starten oder Mobile-Server laufen lassen.')}
          </p>

          {/* A-7: Offline-Weg — Datei ziehen, ganz ohne Gateway/Netz */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void runFileImport(e.dataTransfer?.files ?? null);
            }}
            className={`mt-3 rounded-xl border border-dashed px-3 py-3 transition ${dragging ? 'border-emerald-400/70 bg-emerald-950/30' : 'border-white/12 bg-[#020617]/60'}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black text-slate-200">
                {t('panels.grabber.dropTitle', 'Datei-Drop (ohne Gateway)')}
              </span>
              <label className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-200 border border-white/10 cursor-pointer transition">
                {busy ? t('panels.grabber.importing', 'importiere…') : t('panels.grabber.chooseFile', 'Datei wählen')}
                <input
                  type="file"
                  multiple
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    void runFileImport(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <Pill tone="ok">{t('panels.grabber.localPill', 'Quelle: lokal')}</Pill>
            </div>
            <p className="mt-1.5 text-[10px] font-mono text-slate-500">
              {t('panels.grabber.dropHint', 'Datei hierher ziehen: SHA-256, Kategorie und Ablage im IndexedDB-Asset-Store — ohne Mobile-Server und ohne Netz. Pack-Manifeste werden abgelegt, ihre Items brauchen aber eine URL (erscheinen als übersprungen).')}
            </p>
          </div>
        </PanelSection>

        <PanelSection
          title={t('panels.grabber.pageTitle', 'Seite → Info + Software + Bibliothek')}
          right={<Pill tone={pageBusy ? 'warn' : pageReport ? 'ok' : 'slate'}>{pageBusy ? '…' : t('panels.grabber.dropHintPill', 'Drag & Drop im Chat')}</Pill>}
        >
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t('panels.grabber.pageHint', 'Der Agent zieht die Seite über den Mobile-Server (SSRF-Filter, Katalog), prüft den Inhalt und legt alles intern ab: Seite als Asset, verlinkte Beats/Samples/Styles/Effekte/Filter und ein Bibliothekseintrag für die RAG-Suche. Im Chatfenster genügt es, die URL herüberzuziehen.')}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={pageUrl}
                onChange={(e) => setPageUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runPage(false);
                }}
                placeholder={t('panels.grabber.pagePlaceholder', 'https://media.internal/handbuch/rampe-12')}
                className="flex-1 min-w-[220px] px-3 py-2 rounded-xl bg-slate-900/70 border border-white/10 text-[12px] font-mono text-slate-100 outline-none focus:border-cyan-400/60"
              />
              <button
                type="button"
                onClick={() => void runPage(false)}
                disabled={pageBusy}
                className="px-3 py-2 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-[11px] font-black disabled:opacity-40"
              >
                {pageBusy ? t('panels.grabber.working', 'prüfe & lege ab…') : t('panels.grabber.ingestBtn', 'Prüfen & ablegen')}
              </button>
              <button
                type="button"
                onClick={() => void runPage(true)}
                disabled={pageBusy}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-200 border border-white/10 disabled:opacity-40"
              >
                {t('panels.grabber.reviewBtn', 'Nur prüfen')}
              </button>
            </div>
            {pageReport ? (
              <pre className="whitespace-pre-wrap break-words text-[11px] font-mono leading-relaxed text-slate-200 bg-slate-950/60 border border-white/10 rounded-xl px-3 py-2 max-h-64 overflow-y-auto">
                {pageReport}
              </pre>
            ) : null}
          </div>
        </PanelSection>

        {imports.length > 0 && (

          <PanelSection title={t('panels.grabber.lastRun', 'Letzter Import')} right={<Pill tone={imports.every((i) => i.ok) ? 'ok' : 'warn'}>{imports.filter((i) => i.ok).length}/{imports.length}</Pill>}>
            <ul className="space-y-1.5">
              {imports.map((item, index) => (
                <li key={index} className="rounded-xl border border-white/6 bg-[#050a18]/70 px-2.5 py-2 text-[11px] font-mono">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={item.ok ? 'text-emerald-300' : 'text-rose-300'}>{item.ok ? '✅' : '❌'}</span>
                    <span className="text-slate-300 break-all">{item.imported[0]?.url ?? item.imported[0]?.name ?? `#${index + 1}`}</span>
                    <Pill tone="info">{item.via}</Pill>
                    {item.kind === 'pack' && <Pill tone="warn">{t('panels.grabber.pack', 'Pack')}: {item.pack?.name}</Pill>}
                    {typeof item.bytes === 'number' && <span className="text-slate-500">{formatBytes(item.bytes)}</span>}
                  </div>
                  {item.imported.length > 0 && (
                    <div className="mt-1 text-slate-400">
                      {item.imported.length} ×{' '}
                      {item.imported
                        .slice(0, 4)
                        .map((a) => `${categoryInfo(a.category).icon} ${a.title ?? a.name}`)
                        .join(' · ')}
                      {item.imported.length > 4 ? ` … +${item.imported.length - 4}` : ''}
                    </div>
                  )}
                  {item.error && <div className="mt-1 text-rose-300">{item.error}{item.detail ? ` – ${String(item.detail).slice(0, 140)}` : ''}</div>}
                  {item.hint && <div className="mt-1 text-amber-200/90">{item.hint}</div>}
                  {(item.skipped?.length ?? 0) > 0 && (
                    <div className="mt-1 text-slate-500">
                      {t('panels.grabber.skipped', 'übersprungen')}: {item.skipped!.map((s) => `${s.reason ?? '?'} (${s.url.slice(-40)})`).join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </PanelSection>
        )}

        <PanelSection
          title={t('panels.grabber.catalog', 'Katalog')}
          right={
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => void reload()} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[10px] font-bold text-slate-200 border border-white/10">
                {t('common.refresh', 'aktualisieren')}
              </button>
              <button type="button" onClick={() => void refresh()} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[10px] font-bold text-slate-200 border border-white/10">
                {t('panels.grabber.checkUpdates', 'auf Änderungen prüfen')}
              </button>
            </div>
          }
        >
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id as PackCategory | 'all')}
                className={`px-2 py-1 rounded-full text-[10px] font-bold border transition ${
                  filter === id ? 'bg-white text-slate-900 ring-1 ring-white/50' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                }`}
              >
                {id === 'all' ? `🗂️ ${t('common.all', 'alle')}` : `${categoryInfo(id).icon} ${categoryInfo(id).label}`}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-[11px] font-mono text-slate-400">{t('panels.grabber.empty', 'Noch nichts importiert. URL oben einfügen – oder ein Pack-Manifest (.json mit „dingelschwing_pack“).')}</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row) => {
                const info = categoryInfo(row.asset.category);
                const isText = TEXTUAL.has(row.asset.category) || /text|json|css|javascript/i.test(row.asset.mime ?? '');
                return (
                  <li key={row.asset.id} className="rounded-xl border border-white/8 bg-[#050a18]/70 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-slate-100 truncate">
                          {info.icon} {row.asset.title ?? row.asset.name}
                        </div>
                        <div className="text-[9px] font-mono text-slate-500 break-all">
                          {info.label}
                          {row.asset.categoryKnown ? '' : ' · ?'} · {row.asset.mime ?? '?'} · {formatBytes(row.asset.bytes)} · sha {shortHash(row.asset.sha256)}
                          {row.asset.pack ? ` · pack: ${row.asset.pack}` : ''}
                          {row.asset.localOnly ? ` · ${t('panels.grabber.localOnly', 'nur lokal')}` : ''}
                        </div>
                        {row.asset.url && <div className="text-[9px] font-mono text-slate-600 truncate">{row.asset.url}</div>}
                        {row.asset.tags?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {row.asset.tags.map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-800/80 text-[9px] font-mono text-slate-300">#{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 flex flex-wrap justify-end gap-1">
                        {isText && (
                          <button type="button" onClick={() => void preview(row)} className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[10px] font-bold text-cyan-200 border border-white/10">
                            {row.text ? t('panels.grabber.hide', 'ausblenden') : t('panels.grabber.preview', 'Vorschau')}
                          </button>
                        )}
                        {row.asset.category === 'styles' && (
                          <button
                            type="button"
                            onClick={async () => {
                              patchRow(row.asset.id, { busy: true });
                              const res = await applyStyle(row.asset);
                              patchRow(row.asset.id, { busy: false, message: res.ok ? t('panels.grabber.styleApplied', 'Style angewendet') : `${res.error}` });
                              setStyle(res.ok ? { id: row.asset.id, title: row.asset.title ?? row.asset.name } : appliedStyleInfo());
                            }}
                            className="px-2 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] font-black"
                          >
                            {t('panels.grabber.applyStyle', 'als UI-Style anwenden')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            patchRow(row.asset.id, { busy: true, message: t('panels.grabber.offlining', 'hole Bytes…') });
                            const res = await prefetchOffline(row.asset);
                            patchRow(row.asset.id, {
                              busy: false,
                              message: res.ok ? `${t('panels.grabber.offline', 'offline verfügbar')} (${formatBytes(res.bytes ?? 0)})` : res.error,
                            });
                          }}
                          disabled={row.busy}
                          className="px-2 py-1 rounded-lg bg-sky-800 hover:bg-sky-700 text-white text-[10px] font-bold disabled:opacity-40"
                        >
                          {t('panels.grabber.cache', 'Offline holen')}
                        </button>
                        {isText && (
                          <button
                            type="button"
                            disabled={row.busy}
                            title={t('panels.grabber.libraryHint', 'Inhalt prüfen und als Wissensbasis-Dokument ablegen (Skripte raus, Geheimnisse maskiert)')}
                            onClick={async () => {
                              patchRow(row.asset.id, { busy: true, message: t('panels.grabber.checking', 'prüfe inhalt…') });
                              const text = await textOfAsset(row.asset, 200_000);
                              if (!text) {
                                patchRow(row.asset.id, { busy: false, message: t('panels.grabber.noTextShort', 'kein Text') });
                                return;
                              }
                              const res = await ingestPage(
                                { text, name: row.asset.title || row.asset.name },
                                { importSoftware: false, toDeviceCache: false, toLibrary: true },
                              );
                              patchRow(row.asset.id, {
                                busy: false,
                                message: res.library
                                  ? `📚 ${res.library.chunks} ${t('panels.grabber.chunks', 'Abschnitt/Abschnitte')}${res.library.masked ? ' · maskiert' : ''}`
                                  : res.notes[0] ?? t('panels.grabber.nothingStored', 'nichts abgelegt'),
                              });
                            }}
                            className="px-2 py-1 rounded-lg bg-violet-800 hover:bg-violet-700 text-white text-[10px] font-bold disabled:opacity-40"
                          >
                            📚 {t('panels.grabber.toLibrary', 'Bibliothek')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            const text = contextBlock(row.asset, (await textOfAsset(row.asset)) ?? '');
                            try {
                              await navigator.clipboard.writeText(text);
                              patchRow(row.asset.id, { message: t('panels.grabber.copied', 'als Kontext kopiert') });
                            } catch {
                              patchRow(row.asset.id, { message: t('panels.grabber.copyFailed', 'Zwischenablage blockiert') });
                            }
                          }}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 text-[10px] font-bold text-slate-200 border border-white/10"
                        >
                          {t('panels.grabber.toChat', 'Kontext kopieren')}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteAsset(row.asset);
                            await reload();
                          }}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-rose-900/60 text-[10px] font-bold text-rose-200 border border-white/10"
                        >
                          {t('common.delete', 'löschen')}
                        </button>
                      </div>
                    </div>
                    {row.mediaUrl && AUDIO.has(row.asset.category) && (
                      <audio controls src={row.mediaUrl} className="mt-2 w-full h-8" preload="none">
                        {t('panels.grabber.noAudio', 'Audio nicht abspielbar')}
                      </audio>
                    )}
                    {row.message && <div className="mt-1 text-[10px] font-mono text-amber-200">{row.message}</div>}
                    {row.text && (
                      <pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-black/50 border border-white/8 p-2 text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all">
                        {row.text}
                      </pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>

        <PanelSection title={t('panels.grabber.deviceStorage', 'Geräte-Speicher')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatTile label={t('panels.grabber.cached', 'offline Kopien')} value={cache.count} hint={cache.available ? 'IndexedDB' : t('panels.grabber.noIdb', 'IndexedDB gesperrt')} />
            <StatTile label={t('panels.grabber.cacheBytes', 'davon gesichert')} value={formatBytes(cache.bytes)} />
            <StatTile label={t('panels.grabber.appliedStyle', 'angewendeter Style')} value={style ? style.title ?? style.id : t('common.none', 'keiner')} tone={style ? 'text-emerald-300' : 'text-slate-300'} />
            <StatTile label={t('panels.grabber.backend', 'Katalog liegt bei')} value={<Mono className="break-all">{backend.gatewayBase}</Mono>} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {style && (
              <button
                type="button"
                onClick={() => {
                  clearAppliedStyle();
                  setStyle(null);
                }}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-[11px] font-bold text-slate-200 border border-white/10"
              >
                {t('panels.grabber.clearStyle', 'UI-Style entfernen')}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                await clearLocalCache();
                await reload();
              }}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-rose-900/50 text-[11px] font-bold text-rose-200 border border-white/10"
            >
              {t('panels.grabber.clearCache', 'Offline-Kopien löschen')}
            </button>
          </div>
        </PanelSection>
      </div>
    </PanelShell>
  );
}

export default AssetGrabberPanel;
