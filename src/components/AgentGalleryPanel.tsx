import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, Upload, Copy, Star, Trash2, Sparkles } from 'lucide-react';
import { PanelShell, PanelSection, Pill, Mono } from './panels/ui';
import { gallery, searchGallery, GalleryEntry } from '../lib/galleryStore';
import { GALLERY_CATEGORIES, GalleryCategory, agentToLobeJson } from '../config/agentGallery';

/**
 * Agenten-Gallerie (PWA-Panel) – Marktplatz-Optik, 100 % offline.
 * Suchen, Filtern, Installieren/Aktivieren, Export/Import als LobeChat-JSON.
 */
export default function AgentGalleryPanel({ onClose, onActivate }: { onClose: () => void; onActivate?: (id: string) => void }) {
  const entries = useMemo(() => gallery.all(), []);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GalleryCategory | 'alle'>('alle');
  const [onlyInstalled, setOnlyInstalled] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [detail, setDetail] = useState<GalleryEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let list = searchGallery(query, entries);
    if (category !== 'alle') list = list.filter((e) => e.category === category);
    if (onlyInstalled) list = list.filter((e) => e.installed);
    return list;
  }, [entries, query, category, onlyInstalled]);

  const counts = gallery.counts();
  const active = gallery.active();

  const copy = useCallback(async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setImportMsg(`📋 ${what} in die Zwischenablage kopiert.`);
    } catch {
      setImportMsg(`⚠️ Kopieren nicht erlaubt – nutze den Download-Button (${what}).`);
    }
  }, []);

  const download = useCallback((name: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const runImport = useCallback(
    (raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        const res = Array.isArray(parsed) ? gallery.importMany(parsed) : gallery.importAgent(parsed);
        setImportMsg(res.message);
        rerender();
        if (res.ok) setImportOpen(false);
      } catch (e) {
        setImportMsg(`❌ JSON-Fehler: ${String((e as Error)?.message ?? e)}`);
      }
    },
    [rerender],
  );

  return (
    <PanelShell
      emoji="🖼️"
      title="Agenten-Gallerie · Agent Market"
      subtitle={`${counts.total} Agenten · ${counts.installed} installiert · ${counts.custom} importiert · offline nutzbar`}
      onClose={onClose}
      onRefresh={rerender}
    >
      <div className="flex flex-col gap-4">
        {/* Suche + Filter */}
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Suchen: android · ble · rag · seele …"
            className="flex-1 bg-[#050a18] border border-white/10 focus:border-amber-400/60 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setOnlyInstalled((v) => !v)}
              className={`text-[11px] font-extrabold px-3 py-1.5 rounded-full border transition ${onlyInstalled ? 'bg-amber-600 text-white border-amber-400' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
            >
              ★ installiert
            </button>
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className="text-[11px] font-extrabold px-3 py-1.5 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white shadow-lg hover:brightness-110 flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> Import / Export
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <CategoryChip label="Alle" emoji="🗂️" active={category === 'alle'} onClick={() => setCategory('alle')} count={entries.length} />
          {GALLERY_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.label}
              emoji={c.emoji}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              count={entries.filter((e) => e.category === c.id).length}
            />
          ))}
        </div>

        {active && (
          <div className="flex items-center gap-2.5 text-[11px] rounded-xl bg-emerald-950/40 border border-emerald-700/30 px-3 py-2">
            <span className="text-base">{active.emoji}</span>
            <span className="text-emerald-100 font-bold">Aktiver Agent: {active.name}</span>
            <Pill tone="ok">{active.tools.length} Tools</Pill>
            <button type="button" onClick={() => { gallery.setActive(null); rerender(); }} className="ml-auto text-emerald-300 hover:text-white underline decoration-dotted">
              zurücksetzen
            </button>
          </div>
        )}

        {/* Raster */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((a) => (
            <article
              key={a.id}
              className={`relative rounded-2xl p-3.5 border transition hover:-translate-y-0.5 hover:shadow-xl overflow-hidden ${a.installed ? 'bg-gradient-to-br from-emerald-950/50 to-[#050a18] border-emerald-700/40' : 'bg-[#060f2a]/70 border-white/8'}`}
            >
              {a.installed && <span className="absolute top-2.5 right-2.5 text-amber-300 text-xs">★</span>}
              <div className="flex items-center gap-2.5 mb-2">
                <span className={`grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br ${a.accent} text-lg shadow-lg`}>{a.emoji}</span>
                <div className="min-w-0">
                  <h4 className="text-[13px] font-black text-white leading-tight truncate">{a.name}</h4>
                  <div className="text-[10px] font-mono text-slate-400 truncate">{a.tagline}</div>
                </div>
              </div>
              <p className="text-[11px] text-slate-300/90 leading-snug mb-2.5 overflow-hidden" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                {a.description}
              </p>
              <div className="flex flex-wrap gap-1 mb-3">
                {a.tags.slice(0, 4).map((t) => (
                  <Pill key={t}>{t}</Pill>
                ))}
                {a.custom && <Pill tone="info">import</Pill>}
              </div>
              <div className="flex items-center gap-1.5">
                {a.installed ? (
                  <button
                    type="button"
                    onClick={() => {
                      gallery.setActive(a.id);
                      rerender();
                      onActivate?.(a.id);
                    }}
                    className="flex-1 text-[11px] font-extrabold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:brightness-110 flex items-center justify-center gap-1.5"
                  >
                    <Star className="w-3 h-3" /> Aktivieren
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const r = gallery.install(a.id);
                      setImportMsg(r.message);
                      rerender();
                    }}
                    className="flex-1 text-[11px] font-extrabold px-2.5 py-1.5 rounded-lg bg-gradient-to-br from-amber-600 to-violet-700 text-white hover:brightness-110 flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3 h-3" /> Installieren
                  </button>
                )}
                <button type="button" onClick={() => setDetail(a)} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10">
                  Details
                </button>
                <button
                  type="button"
                  title="Als JSON exportieren"
                  onClick={() => download(`agent-${a.id}.json`, JSON.stringify(agentToLobeJson(a), null, 2))}
                  className="p-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {a.custom && (
                  <button
                    type="button"
                    title="Import entfernen"
                    onClick={() => {
                      setImportMsg(gallery.uninstall(a.id).message);
                      rerender();
                    }}
                    className="p-1.5 rounded-lg bg-white/5 text-rose-300 border border-white/10 hover:bg-rose-900/40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </article>
          ))}
          {!filtered.length && (
            <div className="col-span-full text-center text-xs text-slate-500 py-8">
              Keine Treffer für „{query}“ — Probe <Mono>android</Mono>, <Mono>ble</Mono> oder setze den Filter zurück.
            </div>
          )}
        </div>

        {importMsg && <div className="text-[11px] font-mono text-amber-200 bg-amber-950/30 border border-amber-700/30 rounded-xl px-3 py-2 whitespace-pre-wrap">{importMsg}</div>}

        {importOpen && (
          <PanelSection
            title="Agent importieren / Gallerie exportieren"
            right={
              <div className="flex gap-1.5">
                <button type="button" onClick={() => fileRef.current?.click()} className="text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                  Datei…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const all = gallery.exportAll();
                    setImportText(all);
                  }}
                  className="text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10"
                >
                  Installierte exportieren
                </button>
                <button type="button" onClick={() => void copy(importText, 'JSON')} className="p-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const text = await f.text();
                setImportText(text);
                runImport(text);
              }}
            />
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              spellCheck={false}
              rows={8}
              placeholder='LobeChat-JSON einfügen, z. B. {"meta":{"title":"Mein Agent"},"config":{"systemRole":"…"}}'
              className="w-full bg-[#020617] border border-white/10 rounded-xl p-3 text-[11px] font-mono text-slate-200 outline-none focus:border-violet-400/60"
            />
            <div className="flex flex-wrap gap-2 mt-2">
              <button type="button" onClick={() => runImport(importText)} className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white hover:brightness-110">
                Importieren & aktivieren
              </button>
              <button
                type="button"
                onClick={() => download('dingelschwing-agents.json', importText || gallery.exportAll())}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Als Datei speichern
              </button>
              <button type="button" onClick={() => setImportText('')} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10">
                Feld leeren
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Akzeptiert: unser Export-Format <em>und</em> LobeChat-Agenten (<Mono>meta</Mono>/<Mono>config.systemRole</Mono>/<Mono>openingQuestions</Mono>).
              Arrays werden als Stapel importiert. Gespeichert wird ausschließlich lokal (localStorage) — kein Upload.
            </p>
          </PanelSection>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" onClick={(e) => e.target === e.currentTarget && setDetail(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-[#050a18] ring-1 ring-white/12 p-5 max-h-[80vh] overflow-y-auto">
            <div className="flex items-start gap-3 mb-3">
              <span className={`grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br ${detail.accent} text-2xl`}>{detail.emoji}</span>
              <div>
                <h3 className="text-base font-black text-white">{detail.name}</h3>
                <div className="text-[11px] font-mono text-slate-400">
                  {detail.author} · v{detail.version} · {detail.modelHint}
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">{detail.description}</p>
            <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-amber-200 mb-1.5">System-Anweisung</h4>
            <pre className="text-[11px] font-mono text-cyan-100/90 bg-[#020617] border border-white/8 rounded-xl p-3 whitespace-pre-wrap mb-3">{detail.systemPrompt}</pre>
            <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-amber-200 mb-1.5">Werkzeuge</h4>
            <ul className="text-[11px] font-mono text-slate-300 space-y-1 mb-3">
              {detail.tools.map((t) => (
                <li key={t}>
                  • <Mono>{t}</Mono>
                </li>
              ))}
            </ul>
            {detail.prompts.length > 0 && (
              <>
                <h4 className="text-[10px] font-extrabold uppercase tracking-widest text-amber-200 mb-1.5">Beispiel-Aufrufe</h4>
                <ul className="text-[11px] text-slate-300 space-y-1 mb-3 list-disc pl-4">
                  {detail.prompts.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!detail.installed) {
                    setImportMsg(gallery.install(detail.id, true).message);
                    rerender();
                  }
                  gallery.setActive(detail.id);
                  rerender();
                  onActivate?.(detail.id);
                  setDetail(null);
                }}
                className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:brightness-110"
              >
                Installieren & aktivieren
              </button>
              <button type="button" onClick={() => void copy(detail.systemPrompt, 'System-Prompt')} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-slate-200 border border-white/10 hover:bg-white/10">
                Prompt kopieren
              </button>
              <button type="button" onClick={() => setDetail(null)} className="ml-auto text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10">
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

function CategoryChip({ label, emoji, active, onClick, count }: { label: string; emoji: string; active: boolean; onClick: () => void; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition ${active ? 'bg-cyan-600 text-white border-cyan-300/50' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`}
    >
      {emoji} {label} <span className="text-slate-400">{count}</span>
    </button>
  );
}
