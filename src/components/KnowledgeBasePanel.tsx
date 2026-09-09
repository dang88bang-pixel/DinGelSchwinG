import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Copy, FileUp, Search, Trash2, Zap, Wand2 } from 'lucide-react';
import { PanelShell, PanelSection, Pill, Mono, StatTile } from './panels/ui';
import { rag, readFileAsText, setEmbeddingConfig, primeQueryEmbeddings, RagHit, DEFAULT_EMBEDDING } from '../lib/rag';

/**
 * Wissensbasis (RAG): Dateien/Einfüge-Text → Chunks → Hybrid-Retrieval →
 * zitierfähiger Kontext für die Agent-Engine. Alles lokal (IndexedDB),
 * Embeddings nur wenn der Nutzer sie explizit einschaltet.
 */
export default function KnowledgeBasePanel({ onClose, onUseContext }: { onClose: () => void; onUseContext?: (context: string) => void }) {
  const [docs, setDocs] = useState(() => [...rag.docs.values()]);
  const [chunkCount, setChunkCount] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<RagHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [paste, setPaste] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [topK, setTopK] = useState(5);
  const [embedOn, setEmbedOn] = useState(DEFAULT_EMBEDDING.enabled);
  const [embedModel, setEmbedModel] = useState(DEFAULT_EMBEDDING.model);
  const [lastContext, setLastContext] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    await rag.init();
    setDocs([...rag.docs.values()].sort((a, b) => b.addedAt - a.addedAt));
    setChunkCount(rag.chunks.length);
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setEmbeddingConfig({ ...DEFAULT_EMBEDDING, enabled: embedOn, model: embedModel });
  }, [embedOn, embedModel]);

  // bewusst kein useMemo: rag ist ein Live-Store, Kennzahlen werden bei jedem Render gelesen
  const stats = rag.stats;

  const ingestText = useCallback(
    async (label: string, text: string, source: string, kind: 'text' | 'markdown' | 'pdf-text' | 'manual' = 'text') => {
      if (!text.trim()) {
        setMessage('❌ Kein Text zum Importieren.');
        return;
      }
      setBusy(true);
      try {
        const doc = await rag.addText(label || `import ${new Date().toLocaleTimeString('de-DE')}`, text, source, kind);
        setMessage(`✅ „${doc.name}“ indexiert: ${doc.chunkCount} Abschnitte, ${(doc.sizeBytes / 1024).toFixed(1)} KB.`);
        await refresh();
      } catch (e) {
        setMessage(`❌ ${String((e as Error)?.message ?? e)}`);
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      if (embedOn) await primeQueryEmbeddings([query]);
      const res = rag.search(query, topK);
      setHits(res);
      setSearched(true);
      setLastContext(rag.buildContext(res));
      setMessage(res.length ? `🔎 ${res.length} Treffer (bestes ${res[0].score.toFixed(3)})` : '🔎 Kein verwertbarer Treffer – die Agent-Engine darf dann nicht raten.');
    } finally {
      setBusy(false);
    }
  }, [query, topK, embedOn]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      for (const f of Array.from(files).slice(0, 10)) {
        try {
          const { text, kind } = await readFileAsText(f);
          await ingestText(f.name.replace(/\.[^.]+$/, ''), text, f.name, kind);
        } catch (e) {
          setMessage(`⚠️ ${f.name}: ${String((e as Error)?.message ?? e)}`);
        }
      }
    },
    [ingestText],
  );

  return (
    <PanelShell emoji="📚" title="Wissensbasis · RAG" subtitle={`${stats.docs} Dokumente · ${chunkCount} Abschnitte · ${stats.terms} Begriffe im Index · lokal (IndexedDB)`} onClose={onClose} onRefresh={() => void refresh()} busy={busy}>
      <div className="flex flex-col gap-4">
        {/* Suche */}
        <PanelSection title="Suche in der Wissensbasis" right={<Pill tone={embedOn ? 'ok' : 'slate'}>{embedOn ? 'Hybrid (Vektor + Lexer)' : 'Lexikalisch'}</Pill>}>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="Frage oder Stichwörter, z. B. „batterie ct45p spanning“"
              className="flex-1 bg-[#020617] border border-white/10 focus:border-cyan-400/60 rounded-xl px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <select value={topK} onChange={(e) => setTopK(Number(e.target.value))} className="bg-[#020617] border border-white/10 rounded-xl px-2 text-[11px] font-mono text-slate-200">
              {[3, 5, 8, 12].map((n) => (
                <option key={n} value={n}>
                  top {n}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void search()} className="flex items-center gap-1.5 text-[12px] font-extrabold px-3.5 py-2 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white hover:brightness-110">
              <Search className="w-3.5 h-3.5" /> Suchen
            </button>
          </div>

          {searched && (
            <div className="mt-3 space-y-2">
              {hits.length === 0 && <p className="text-[11px] text-amber-200">Keine Treffer. Agent-Antwort muss dann „nicht in der Wissensbasis“ lauten.</p>}
              {hits.map((h) => (
                <article key={h.chunk.id} className="rounded-xl bg-[#050a18] border border-white/8 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <span className="text-[11px] font-black text-amber-200 truncate">📄 {h.citation}</span>
                    <span className="flex items-center gap-1.5">
                      <Pill tone={h.score > 0.5 ? 'ok' : h.score > 0.2 ? 'warn' : 'slate'}>score {h.score.toFixed(3)}</Pill>
                      <Pill tone="info">abschnitt {h.chunk.index + 1}</Pill>
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-200 leading-relaxed">{h.snippet}</p>
                  {h.vector > 0 && <p className="text-[10px] font-mono text-slate-500 mt-1.5">vektor {h.vector.toFixed(3)} · lexer {h.lexical.toFixed(2)}</p>}
                  <div className="flex gap-1.5 mt-2">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(h.chunk.text).then(() => setMessage('Abschnitt kopiert.'), () => setMessage('Kopieren blockiert.'))} className="text-[10px] font-bold px-2 py-1 rounded bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                      <Copy className="w-3 h-3 inline mr-1" /> Abschnitt
                    </button>
                  </div>
                </article>
              ))}
              {lastContext && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      onUseContext?.(lastContext);
                      onClose();
                    }}
                    className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-700 text-white hover:brightness-110 flex items-center gap-1.5"
                  >
                    <Wand2 className="w-3.5 h-3.5" /> Als Kontext in den Chat übernehmen
                  </button>
                  <button type="button" onClick={() => void navigator.clipboard?.writeText(lastContext)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10">
                    Prompt-Kontext kopieren ({lastContext.length} Zchn.)
                  </button>
                </div>
              )}
            </div>
          )}
        </PanelSection>

        {/* Dokumente */}
        <div className="grid lg:grid-cols-2 gap-4">
          <PanelSection title="Hinzufügen" right={<Pill tone="slate">.txt · .md · .csv · .log</Pill>}>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.csv,.log,.json,.yaml,.yml,.pdf,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <div className="flex gap-2 mb-2.5">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex-1 text-[11px] font-extrabold px-3 py-2 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 text-white hover:brightness-110 flex items-center justify-center gap-1.5">
                <FileUp className="w-3.5 h-3.5" /> Dateien auswählen
              </button>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name für Einfüge-Text"
                className="w-1/2 bg-[#020617] border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-white outline-none focus:border-amber-400/60"
              />
            </div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFiles(e.dataTransfer.files);
              }}
              className="rounded-xl border border-dashed border-white/15 bg-[#020617]/60 p-2"
            >
              <textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                rows={7}
                spellCheck={false}
                placeholder="… oder Text hierher ziehen / einfügen (Handbuch-Abschnitte, Protokolle, Konfig-Kommentare)"
                className="w-full bg-transparent text-[11.5px] font-mono text-slate-200 outline-none resize-y"
              />
              <div className="flex gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    void ingestText(name, paste, 'einfügung');
                    setPaste('');
                    setName('');
                  }}
                  className="text-[11px] font-extrabold px-3 py-1.5 rounded-lg bg-white/10 text-white border border-white/15 hover:bg-white/20"
                >
                  Indexieren
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPaste('');
                    setMessage('Feld geleert.');
                  }}
                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                >
                  Verwerfen
                </button>
              </div>
            </div>
          </PanelSection>

          <PanelSection title="Bestand" right={<Pill tone="bad" >{docs.length ? 'löschen möglich' : 'leer'}</Pill>}>
            {!docs.length ? (
              <p className="text-[11px] text-slate-500">Noch nichts indexiert. Zwei Beispiele zum Ausprobieren:</p>
            ) : (
              <ul className="space-y-1.5 mb-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-[11px] font-mono rounded-lg bg-[#020617] border border-white/8 px-2.5 py-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span className="text-white/90 truncate flex-1">{d.name}</span>
                    <span className="text-slate-500">{d.chunkCount} §§</span>
                    <span className="text-slate-500">{(d.sizeBytes / 1024).toFixed(1)} KB</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await rag.removeDoc(d.id);
                        await refresh();
                        setMessage(`🗑️ „${d.name}“ entfernt.`);
                      }}
                      className="p-1 rounded hover:bg-rose-900/40 text-rose-300"
                      title="Dokument entfernen"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  void ingestText(
                    'CT45P-Betriebshinweise',
                    [
                      '# CT45P Xon+ Betriebshinweise',
                      '',
                      '## Stromversorgung',
                      'Der CT45P Xon+ nutzt eine austauschbare Lithium-Thionylchlorid-Zelle (Li-SOCl2). Bei 10 Lesungen pro Tag werden mindestens 5 Jahre Laufzeit erreicht; unter 2,4 V meldet das Token Batteriewarnung im Status-Feld.',
                      '',
                      '## Reichweite',
                      'Interne PCB-Antenne, 10-15 m Freifeld. In Metallnähe (Tor, Container) bricht die Reichweite auf 2-4 m ein - Lesepunkt markieren und RSSI -75 dBm als Grenzwert konfigurieren.',
                      '',
                      '## Tamper',
                      'Gehäuseöffnung fuehrt zum Loeschen des Root-Keys im Token. Das Gateway zaehlt Tamper-Ereignisse und sperrt das Token bei ueberschreiten von max_tamper_count.',
                    ].join('\n'),
                    'beispiel',
                    'markdown',
                  )
                }
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5" /> Beispieldoku indexieren
              </button>
              <button
                type="button"
                onClick={async () => {
                  await rag.clear();
                  await refresh();
                  setHits([]);
                  setSearched(false);
                  setMessage('🗑️ Wissensbasis geleert.');
                }}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-950/50 border border-rose-800/40 text-rose-200 hover:bg-rose-900/50"
              >
                Alles löschen
              </button>
            </div>
          </PanelSection>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatTile label="Dokumente" value={stats.docs} />
          <StatTile label="Abschnitte" value={chunkCount} tone="text-cyan-200" />
          <StatTile label="Begriffe" value={stats.terms} tone="text-violet-200" />
          <StatTile label="Embeddings" value={embedOn ? 'an' : 'aus'} tone={embedOn ? 'text-emerald-200' : 'text-slate-200'} hint={embedOn ? embedModel : 'nur lexer'} />
        </div>

        <PanelSection title="Abruf-Verhalten" right={<Pill tone={embedOn ? 'ok' : 'info'}>{embedOn ? 'hybrid' : 'offline-first'}</Pill>}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-slate-300">
              <input type="checkbox" checked={embedOn} onChange={(e) => setEmbedOn(e.target.checked)} className="accent-cyan-500" />
              Vektor-Suche aktivieren (benötigt lokalen Endpoint, z. B. Ollama)
            </label>
            <input value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} className="bg-[#020617] border border-white/10 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-200 w-44" />
            <Mono>/rag/embeddings → /api/embeddings</Mono>
          </div>
          <p className="text-[10.5px] text-slate-500 mt-2 leading-relaxed">
            Ohne Vektor-Suche zählt reine Termgewichtung (TF·IDF mit Abdeckungs- und Längenstraf-Faktor) – vollständig offline und reproduzierbar.
            Mit Endpoint werden Query und Abschnitte zusätzlich eingebettet und zu 55/45 gewichtet. Chunks bleiben in diesem Browser-Profil.
          </p>
        </PanelSection>

        {message && <div className="text-[11px] font-mono text-amber-200 bg-amber-950/30 border border-amber-700/30 rounded-xl px-3 py-2">{message}</div>}
      </div>
    </PanelShell>
  );
}
