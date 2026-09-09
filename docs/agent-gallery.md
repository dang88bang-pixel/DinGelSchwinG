# 🖼️ Agenten-Galerie, Skills & RAG-Wissensbasis

Portiert aus dem LobeChat-Referenzmodell („Agent Market“, Persona-Galerie, Skills Marketplace,
JSON-Import/-Export, RAG-Upload) – **nativ in React + Capacitor**, ohne zusätzlichen Stack.

| Baustein | Datei | Inhalt |
|---|---|---|
| Katalog | `src/config/agentGallery.ts` | `GalleryAgent`, 13 Profile, Kategorien, `findAgent()`, `agentToLobeJson()` |
| Persistenz | `src/lib/galleryStore.ts` | localStorage (`dingelschwing.gallery.v1`): installiert/aktiviert, Import/Export |
| Panel | `src/components/AgentGalleryPanel.tsx` | Suche, Kategorien, Installieren/Aktivieren, JSON-Import/-Export |
| Wissensbasis | `src/lib/rag.ts` | Chunking + BM25-ähnliche Bewertung, Index in IndexedDB/localStorage |
| Panel | `src/components/KnowledgeBasePanel.tsx` | Upload (`.md/.txt/.csv/.json`), Statistik, Suche, Kontext-Vorschau |
| Skills | `src/config/skills.ts` ↔ `desktop/data/skillz.md` | 27 (Web) / 27 (Desktop) Werkzeuge inkl. `mcp_*`, `gateway_*`, `knowledge_*` |
| Desktop | `desktop/utils/agentGallery.py` | `AgentGallery` + `KnowledgeBase`, Daten unter `desktop/data/` |

## 1️⃣ Galerie (13 Profile)

```
android-dev 🤖 · app-builder 📱 · figma-to-compose 🎨      ← App-Entwicklung (build-android-apps,
                                                              figma-to-mobile, sketch2app als Idee)
ble-security 🛡️ · nfc-token-flow 💳                        ← CT45P Xon+ / PN532-Kontext
network-rag 📚 · dashboard-analyst 📊                       ← Doku & Observability
cad-3d 🧊 · dataset-explorer 🗄️                            ← three.ws/AgentCAD · read-only SQL
rook ♟️ · nyx 🌘 · sage 🦉 · vex ⚡                          ← „Seelen“ (Persona-Tonarten)
```

Jedes Profil trägt: `id`, `name`, `tagline`, `description`, `systemPrompt`, `tools[]`, `category`,
`tags[]`, `author`, `accent` (Farbe), `source`. Die Werkzeugnamen sind **präfixiert**
(`mcp-mobile-server:*`, `gateway:*`, `knowledge:*`, `mcp:*`, `core:*`) und werden beim Aktivieren in
den Agenten-Kontext übernommen: `AgentEngine.buildSystemPrompt()` hängt das aktive Profil als
System-Anteil an, und die Desktop-Konsole injiziert es in `_llm_context()`.

```bash
# Im Chat (Web und Desktop identisch)
gallerie                      # Übersicht + Installationsstatus
gallerie android              # Kategorie-/Suchfilter
installiere agent ble-security
aktiviere agent network-rag
```

**Import/Export**: Der Button „📤 Export“ erzeugt eine LobeChat-kompatible JSON-Struktur
(`agentToLobeJson()`), „📥 Import“ akzeptiert dieselbe Form wie auch `{meta, agents:[…]}`.
Damit ist der Austausch mit der Community möglich, ohne dass etwas nach außen gesendet wird.

## 2️⃣ RAG-Wissensdatenbank

- **Chunking**: Markdown-Absätze, Zielgröße ~1200 Zeichen, Überlappung 200 Zeichen; jeder Chunk
  behält Überschrift + Dokumentnamen (für Zitate).
- **Bewertung**: TF-RARITY-artige Gewichtung + Längen-Normierung, exakte Phrase-Bonuswertung.
  Tokenizer ist zweistufig, damit `2-4`, `aes-128`, `CT45P-0001` nicht zerfallen.
- **Kontextinjektion**: `AgentEngine` sucht vor jeder Antwort (`top=3`) und stellt die Fundstellen
  über die Antwort-Anweisung; `⚡ Zitat:`-Zeilen zeigen Dokument + Abschnitt.
- **Speicher**: ausschließlich lokal (IndexedDB, Fallback localStorage). Kein Upload, kein Fetch.
- **Desktop**: dieselbe Logik in `desktop/utils/agentGallery.py::KnowledgeBase` – Dokumente liegen
  als `desktop/data/knowledge/<slug>.md`, Bewertung spiegelt `src/lib/rag.ts`.

```bash
lern: Rufnummern Werkstor: 0221 555-0100 (Tag) / 0221 555-0199 (Nacht)
suche im wissen: challenge ttl
suche im wissen: batterie top=5
```

Im Panel: Dateien per Dropzone laden, „Index neu bauen“, Volltextsuche mit Trefferzitaten,
„Als Kontext an Agent übergeben“. Gelöschte Dokumente verschwinden aus dem Index (kein Restore,
bewusst – Privacy-first statt Papierkorb).

## 3️⃣ Live-Statusleiste & Metriken

Über dem Eingabefeld (Web) bzw. in der Statuszeile (Desktop):

```
[🟢 Live] Zeit: 12s | Tokens: 1.234 | Kosten: $0.012 | Cache: 87%
```

Quelle ist `src/lib/liveMetrics.ts` (Ring von 50 Läufen, 8-s-Antwortcache wie in der Bridge).
Jeder Lauf wird an `POST /mcp/metrics/run` gemeldet → Prometheus (`dingelschwing_agent_*`),
siehe [docs/monitoring.md](monitoring.md). Desktop: `dashboard`.

## 4️⃣ Sicherheit / Privatsphäre

| Aspekt | Regel |
|---|---|
| Galerie-Import | validiert `id`/`name`, kürzt Felder, ignoriert Unbekanntes; `systemPrompt` wird nie ausgeführt |
| Tools | Aufrufe nur über Bridge (`/mcp/call`) bzw. Gateway-Kommandos; keine direkte Socket-/Shell-API im WebView |
| Schreibende Tool-Aufrufe | Skills mit `needs_approval` zeigen eine Vorschau, Ausführung erst nach Bestätigung (SafeDataBaseMCP-Muster) |
| Wissensdatenbank | lokal; Uploads verlassen das Gerät nicht |
| Model-Download | nur auf expliziten Klick, dann Cache im Service Worker (`/models/*`) |

## 5️⃣ Datenexport aus dem TypeScript-Katalog (Desktop-Kopie erzeugen)

`desktop/data/agent_gallery.json` ist eine Kopie des TS-Katalogs. Nach Änderungen am Katalog neu erzeugen:

```bash
cat > /tmp/export-gallery.mts <<'TS'
import { writeFileSync } from 'node:fs';
import { GALLERY_AGENTS } from './src/config/agentGallery';
writeFileSync('desktop/data/agent_gallery.json',
  JSON.stringify({ _comment: 'exportiert aus src/config/agentGallery.ts', exportedAt: new Date().toISOString(), agents: GALLERY_AGENTS }, null, 2) + '\n');
TS
npx vite-node /tmp/export-gallery.mts && rm /tmp/export-gallery.mts
```

Ein Skript-Ordner existiert dafür bewusst nicht; der Zwischenschritt bleibt kurzlebiger Code.

## 6️⃣ Grenzen & offene Punkte

- 13 statt 488 Profile: die Galerie ist ein **kuratorter Startsatz** ohne Netzwerk-Anbindung
  (offline-first). Ein Remote-Katalog lässt sich über den Import-Button einspielen.
- Kein Multi-User-Backend: `galleryStore` ist pro Gerät/Geräteprofil.
- Die „Seelen“ (rook/nyx/sage/vex) ändern nur Ton und Hinweisliste, nicht die Rechte-Matrix –
  Rollen bleiben in `rbac.ts`/`auth.py` maßgeblich.
- Embedding-Suche (Vektoren) ist bewusst nicht verbaut: ohne Modell-Download bleibt die Suche
  deterministisch, prüfbar und offline. Optionaler Ausbau: lokale Embeddings via
  `@huggingface/transformers` + cosine-Similarity in `src/lib/rag.ts` (Indexversion hochziehen).
