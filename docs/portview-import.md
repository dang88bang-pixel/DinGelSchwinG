# PortView (automatischer Port) + Software-Grabber (URL-Import)

Zwei Dinge, die die Mobile-App unabhängig von Tipparbeit und Konfigurations-Dialogen machen:

1. **PortView** – die App findet Host *und* Port des Mobile-Servers selbst. In der
   nativen Hülle über die **eigene Capacitor-Brücke** (Java), im Browser über einen
   HTTP-Probe. Ergebnis: `http://192.168.4.21:8791` steht in der App, ohne dass
   jemand etwas eintippt.
2. **Grabber** – `URL → Katalog`: Beats, Samples, UI-Styles, Effekte und Filter
   werden importiert, dedupliziert und offline verfügbar gemacht (Gateway-Katalog +
   IndexedDB auf dem Gerät). Importierte CSS-Styles lassen sich live anwenden.

> Beide Funktionen sind **optional und ausfallsicher**: ohne Gateway läuft die App
> wie vorher (relative Pfade über Dev-Proxy/Bridge), ohne Gateway-Grabber importiert
> der Browser direkt.

---

## 1. PortView

### Warum nativ?

Eine WebView darf dreierlei nicht, was die Automatik braucht:

| Bedürfnis | Browser/WebView | native Brücke (Android) |
| --- | --- | --- |
| UDP-Broadcast `:18791` empfangen | ❌ | ✅ `DatagramSocket` |
| Fremd-Port anspielen (Probe) | ❌ (nur fetch/https) | ✅ `HttpURLConnection` |
| `http://`-Ziel von `https://`-Seite | ❌ Mixed Content | ✅ CapacitorHttp/nativ |

Deshalb liegt der eigentliche Suchlauf in
[`android/app/src/main/java/com/dingelschwinng/moeagent/PortViewPlugin.java`](../android/app/src/main/java/com/dingelschwinng/moeagent/PortViewPlugin.java)
(Plugin-Name `PortView`, registriert in `MainActivity.onCreate`). Die
TypeScript-Schicht [`src/lib/portview.ts`](../src/lib/portview.ts) nutzt das Plugin,
wenn wir nativ laufen, und fällt sonst auf `probeWeb()` zurück.

### Protokoll (UDP)

```
Client  →  Gateway        :18791 (DGS_DISCOVER_PORT)
  Payload: "DGS_DISCOVER" + ' ' + {"nonce":"<hex>"}

Gateway →  Client (Peer-Addresse des Pakets)
  {"product":"DinGelSchwinG","service":"dingelschwing-gateway","version":"1.0.0",
   "hostname":"dgs-gw-04","ip":"192.168.4.21","http_base":"http://192.168.4.21:8791",
   "ports":{"http":8791,"tcp":8765,"bridge":8790,"discovery":18791},"nonce":"<hex>"}
```

Implementierung: [`mobile-server/discovery.py`](../mobile-server/discovery.py)
(`DiscoveryResponder`, `build_announce`). Der Responder beantwortet **nur** Pakete,
die mit `DGS_DISCOVER` beginnen; alles andere ignoriert er. Er läuft im Gateway-Prozess
und kann mit `--no-discover` abgeschaltet werden (PortView nutzt dann nur den HTTP-Pfad).

Wichtig: Clients verlassen sich auf die **Quell-IP des empfangenen Pakets**, nicht auf
`ip`/`http_base` – die Felder sind Hinweise (in Containern steht dort oft eine
link-lokale Adresse).

### HTTP-Vertrag (der eigentliche Beweis)

Ein Fund zählt erst, wenn `GET /status` (Gateway) bzw. `GET /mcp/health` (Bridge)
unseren Marker zurückgibt:

```jsonc
// GET /status  →  mobile-server/gateway.py::GatewayState.snapshot()
{ "ok": true, "product": "DinGelSchwinG", "service": "dingelschwing-mobile-gateway",
  "ports": { "http": 8791, "tcp": 8765, "bridge": 8790, "discovery": 18791 },
  "portview": { "udp_discovery": true, "discovery": { "running": true, "answers": 7 },
                "imports": { "count": 3, "bytes": 12840 } } }
```

Der Suchlauf in der App läuft damit in dieser Reihenfolge:

1. `native` (App): UDP-Runde → Kandidaten ⊕ {`127.0.0.1`, `10.0.2.2`, lokale IPs,
   `extraHosts`} → HTTP-Probe `/status` + `/mcp/health`; optional `/24`-Sweep
   (`sweepSubnet`, dann nur Gateway-Port, 180 ms/Host, 24 Threads).
2. `web` (PWA/Dev): HTTP-Probe gegen `127.0.0.1`, `localhost`, `10.0.2.2`,
   aktuelle Origin, Ports `8791`/`8790`; zusätzlich `/gateway/status` (über die
   Bridge) – daraus wird der echte Gateway-Port abgeleitet und **nachprobiert**.
3. Übernommen wird der Treffer mit der niedrigsten Latenz
   (`applyCandidates()` in `src/lib/portview.ts`).

### Wo die App das speichert

[`src/lib/endpoint.ts`](../src/lib/endpoint.ts) hält `bridgeBase` + `gatewayBase`
(LocalStorage-Key `dgs.endpoint.v1`, cross-tab synchronisiert) und ist der **einzige**
Ort, der Basen kennt:

| Aufruf | ohne Fund | mit Fund |
| --- | --- | --- |
| `apiUrl('/mcp/health')` | `/mcp/health` | `http://host:8790/mcp/health` |
| `apiUrl('/gateway/nfc')` | `/gateway/nfc` | `http://host:8790/gateway/nfc` ← **über die Bridge**, weil nur die den `agent_proof` signieren darf |
| `gatewayUrl('/status')` | `/gateway/status` | `http://host:8791/status` (direkt, schneller) |
| `assetUrl(id)` | `/gateway/import/file/<id>` | `http://host:8791/import/file/<id>` |

Befehle mit Nachweis gehen also **immer** über die Bridge; nur Lesezugriffe und
Asset-Bytes ans Gateway direkt. Manuelle Einstellungen (`source: "manual"`) werden von
der Automatik nicht überschrieben – erst „Automatik erzwingen“ im Panel.

App-Start (`src/main.tsx`): in der nativen Hülle läuft `autoConfigure()` einmal vor
dem Rendern, `?noportview` unterdrückt es.

### Panel 🧭 PortView

Header-Leiste des Dashboards (bzw. der runde 🧭-Knopf mobil) öffnet es:

* **Aktuelle Einstellung** – Weg (nativ/Browser), Gateway, Bridge, Quelle, Latenz
* **Automatik / Nur suchen / Verbindung testen**, Haken für *erzwingen* und */24-Sweep*
* **Gefundene Endpunkte** – jeder einzeln übernehmbar (`base`, `kind`, `via`, ms)
* **Manuell** – zwei Felder als Notfall (andere Ports, https, mehrere Hallen)
* **Was der Server meldet** – `product`-Marker, UDP-Laufzeit + Antwortzähler,
  Port-Triple, Kataloggröße: damit sieht man im Feld sofort, ob Broadcasts ankommen

### Desktop-Konsole

`desktop/utils/clients.py` hat denselben Mechanismus (`discover_gateway()`,
`gateway_base()`, `portview_status()`). Er ist **faul**: zuerst wird die konfigurierte
bzw. Default-Adresse versucht, erst bei `nicht_erreichbar` wird gesucht und der Aufruf
einmal wiederholt. Umschalten: `DGS_PORTVIEW=0`, Überspringen per `DGS_GATEWAY_URL`.

CLI-Schnelltest von jeder Maschine im Netz:

```bash
npm run mcp:portview           # python3 mobile-server/discovery.py
python3 mobile-server/discovery.py --hosts 127.0.0.1,192.168.4.21 --timeout 0.9
```

---

## 2. Software-Grabber (Import von URLs)

### Fluss

```
App/Panel ──POST /import {url,category?,tags?,filename?,persist?}──▶  gateway
   ▲                                                                   │ check_url (Schema, DNS, SSRF-Filter)
   │                                                                   │ download  (max 64 MiB, 20 s, 5 Redirects je Hop geprüft)
   │                                                                   │ Kategorie (MIME/Endung → Wörter), SHA-256
   │                                        Pack-Manifest? ── ja ──▶ items (≤ 40) einzeln, ein Hop tiefer
   └──GET /imports · GET /import/file/<id> ◀──────┴── data/imports/<sha16>__<name> + index.json
```

* Serverseitig: [`mobile-server/importer.py`](../mobile-server/importer.py)
  (`ImportStore`, `ImportPolicy`, `check_url`, `download`).
* Endpunkte: `mobile-server/mobile_ble_server.py` (`GET /imports`,
  `GET /import/categories`, `GET /import/preview?url=`, `GET /import/file/<id>`,
  `POST /import`, `POST /import/delete`). Alles antwortet mit CORS, die Bridge
  reicht `/gateway/import/*` durch (Binärdaten byte-genau, 180 s Zeitbudget).
* App: [`src/lib/grabber.ts`](../src/lib/grabber.ts) (Import, Katalog, Offline,
  Style-Anwendung), [`src/lib/assetStore.ts`](../src/lib/assetStore.ts) (IndexedDB),
  [`src/lib/packs.ts`](../src/lib/packs.ts) (Kategorien + Manifest-Typen).
* Desktop: `import_url()`, `list_imports()`, `delete_import()`,
  `import_asset_path()`, `describe_imports()` in `desktop/utils/clients.py`.

### Kategorien

| Kategorie | erkannt durch | Sinn |
| --- | --- | --- |
| 🥁 `beats` | Audio-MIME/-Endungen ohne One-Shot-Hinweis | Loops, Stems, Spuren |
| 🎚️ `samples` | Audio + `one-shot`,`hit`,`vox`,`foley`,`chop` | One-Shots |
| 🎨 `styles` | `.css/.scss/.less`, `text/css`, Theme-Wörter | UI-Styles (live anwendbar) |
| 🌀 `effects` | `.jsfx/.fxp/.vcv/.patch/.preset`, JSON/Text ohne anderen Hinweis | Presets, Patches |
| 🧊 `filters` | `.glsl/.frag/.vert/.shader/.cube/.3dl` | Shader, LUTs, Masken |
| 📦 `other` | Rest | wird gespeichert, mit `?` markiert |

Dasselbe Regelwerk liegt in `packs.ts` (`detectCategory`) für den Browser-Import ohne
Gateway – Kategorienamen sind also über alle Schichten identisch.

### Grenzen und Sicherheit (bewusst eng)

* Nur `http`/`https`; Redirects werden **pro Hop** erneut geprüft (max. 5, keine Schleifen).
* IP-Filter über `ipaddress`: `169.254.0.0/16` (Cloud-Metadaten), `fe80::/10`,
  Multicast, `reserved`, `0.0.0.0` sind **immer** zu. Loopback und private Netze nur,
  wenn erlaubt – Standard im Werk: an (`DGS_IMPORT_ALLOW_PRIVATE=1`,
  `DGS_IMPORT_ALLOW_LOOPBACK=1`), hart gesetzt mit `--import-allow-private 0`.
* Größe: `DGS_IMPORT_MAX_BYTES` (Default 64 MiB) – gegen deklarierte **und** gestreamte Länge.
* Zeit: `DGS_IMPORT_TIMEOUT_S` (20 s); das Browser-/Panel-Timeout (180 s) lässt Luft für große Dateien.
* Dateinamen: `safe_filename()` glättet Pfade, `..`-Folgen, Kontrollzeichen; cap 120 Zeichen.
* Ablage: `<sha256[:16]>__<name>` unter `data/imports/`, Index `index.json`;
  `file_for()` verlässt das Verzeichnis nicht (Traversal-Test vorhanden).
* Dedupe: gleicher SHA-256 ⇒ Treffer im Index, keine zweite Kopie (`deduped: true`).
* Audit: jeder Import/blockierte Versuch schreibt `import` / `import_blocked` /
  `import_failed` / `import_dedupe` in `data/gateway_audit.jsonl`.
* Metriken: `dingelschwing_gateway_imports`, `_import_bytes`, `_import_errors`,
  `_import_assets`, `_import_catalog_bytes`, `_import_packs_total`,
  `_import_dedupes_total`, `dingelschwing_gateway_portview_answers`.

Abschalten: `--no-import` (dann melden die Endpunkte `grabber_deaktiviert`).

### Pack-Manifest (eine URL, viele Assets)

```json
{
  "dingelschwing_pack": 1,
  "name": "Werkhof-Demo",
  "version": "1",
  "category": "beats",
  "author": "Medienarchiv",
  "license": "CC0-1.0",
  "items": [
    { "url": "kicks/loop_4bar.wav", "title": "Rampe 4/4", "tags": ["loop"], "mime": "audio/wav" },
    { "url": "https://files.internal/ui/dark.css", "title": "Dunkel", "category": "styles" }
  ]
}
```

Relative `url`-Werte werden gegen die Manifest-URL aufgelöst. Überzählige Items
(`> DGS_IMPORT_MAX_ITEMS`, Default 40) werden abgeschnitten und gemeldet; ein
blockierter Eintrag landet in `skipped[]` und bricht den Rest **nicht** ab.
Beispiel im Repo: [`public/demo/packs/dgs-demo-pack.json`](../public/demo/packs/dgs-demo-pack.json)
(Panel-Button „Demo-Pack laden“ füllt die URL mit `location.origin` daraus).

### Antworten

```jsonc
// POST /import {"url":"http://files.internal/packs/dgs-demo-pack.json"}
{ "ok": true, "kind": "pack", "url": "…", "bytes": 612,
  "pack": { "name": "Werkhof-Demo", "version": "1", "category": "beats", "items": [ … ] },
  "imported": [ { "id": "9f2c1a…", "sha256": "…", "name": "loop_4bar.wav", "title": "Rampe 4/4",
                  "category": "beats", "category_known": true, "mime": "audio/x-wav",
                  "bytes": 176, "url": "http://…", "host": "files.internal", "tags": ["loop"],
                  "pack": "Werkhof-Demo", "imported_at": 1777593600.12,
                  "local_url": "http://127.0.0.1:8791/import/file/9f2c1a…" } ],
  "skipped": [ { "url": "file:///etc/passwd", "reason": "schema_nicht_erlaubt" } ] }

// Fehler: 422 { "ok": false, "error": "zu_gross" | "host_gesperrt" | "privatnetz_blockiert"
//               | "schema_nicht_erlaubt" | "netzwerk" | "http_status" | "timeout…" , "hint": … }
```

### Was das Panel damit macht (📥 Grabber)

Mehrere URLs (eine pro Zeile, max. 12 pro Lauf), optionale Kategorie/Schlagwörter;
Pro-Ergebnis mit Grund und `skipped`-Liste. Katalogansicht mit Kategorie-Filtern,
pro Asset: Vorschau (Text), **als UI-Style anwenden** (CSS live, überlebt Neuladen,
`localStorage`-Schlüssel `dgs.applied-style.v1`), **Offline holen** (Bytes →
IndexedDB), **Kontext kopieren** (Asset + Text als Codeblock für den Chat), Löschen.
Fehlt das Gateway, werden Funde nur lokal abgelegt (`localOnly`) und das Panel sagt es.

### Android-Berechtigungen dafür

`android/app/src/main/AndroidManifest.xml` deklariert neben `INTERNET` auch
`NFC`, `CAMERA`, BLE (`BLUETOOTH_SCAN` mit `neverForLocation`, `BLUETOOTH_CONNECT`,
Legacy `BLUETOOTH`/`BLUETOOTH_ADMIN`/`ACCESS_FINE_LOCATION` mit `maxSdkVersion="30"`)
und `<uses-feature … required="false">` für BLE/NFC/Kamera.

Netzwerk-Klartext: `res/xml/network_security_config.xml` erlaubt `http` (PortView
findet das Werk-Gateway üblicherweise als IP). Für TLS-Rollouts liegt
`network_security_config_hardened.xml` bereit (nur Loopback, `.local`, `.lan`,
`.home.arpa`) – im Manifest eine Zeile tauschen.

---

### 2b. Seiten-Ingest: URL ins Chatfenster ziehen → prüfen → intern ablegen

Der Grabber kann mehr als Dateien importieren: Der Agent zieht eine **Seite**, liest ihren
Inhalt, **prüft** ihn und legt **alles intern** ab. Auslöser ist ein Drag & Drop ins Chatfenster
(`AgentConsole`) oder ein Chat-Befehl.

```
URL/Datei ziehen ──▶ AgentConsole.onDrop ──▶ engine.ingestDroppedUrl(url)
                                              │
                    "importiere <url> in die bibliothek"  (Intent im Agenten)
                                              ▼
      grabber.grabFromUrl(url) ──▶ POST /gateway/import {url}      (SSRF-Filter, Limits, Dedupe)
                                              │  Asset der Seite + Text (textOfAsset)
                                              ▼
      pageIngest.extractReadable(html)   → Titel, Gliederung, Volltext, Skripte/Style raus
      pageIngest.maskSecrets(text)       → Key-/Passwort-Muster werden maskiert
      pageIngest.findAssetLinks(html)    → verlinkte .wav/.mp3/.css/.jsfx/.glsl/.cube/Manifeste
      pageIngest.reviewContent(…)        → Prüfpunkte (siehe unten) ⇒ verdict ok|attention|blockiert
                                              ▼
                          ┌───────────────────┼───────────────────────┐
                 Seite als Asset      Software-Links importieren   RAG-Dokument
                 (data/imports/)      (Katalog + Offline-Cache)   (data/knowledge/ bzw. IndexedDB)
```

**Prüfpunkte** (`reviewContent`, identisch in `src/lib/pageIngest.ts` und
`desktop/utils/page_ingest.py`):

| Prüfpunkt | ok | warn | blockiert |
|---|---|---|---|
| Quelle abrufbar | via gateway/browser/datei | – | Fehler des Grabbers (`host_gesperrt`, `zu_gross`, `netzwerk`, …) |
| Größe | ≤ 24 MiB | größer (Vorschau gekürzt) | – |
| Lesbarer Text | ≥ 40 Wörter | < 40 Wörter oder Binärdatei | – |
| Gliederung | ≥ 1 Überschrift (H1–H3) | keine erkannt | – |
| Skripte/Formatierung | kein `<script>`/`<style>` | entfernt (Zähler im Bericht) | – |
| Schutzbedarf | keine Muster | maskiert (`Privater Schlüssel`, `AWS-Style Key`, `Passwort-Zuweisung`, `PSK/Secret`, `Langer Hex-Key`) | – |
| Verlinkte Software | ≥ 1 Treffer | keine | – |
| Duplikat | neu | gleicher SHA-256 bereits im Katalog | – |

`blockiert` ⇒ es wird **nichts** abgelegt, der Bericht nennt Grund + Hinweis. `attention` wird
abgelegt, der Hinweis bleibt im Bericht sichtbar.

**Rufarten**

| Ich will… | Chat / Panel |
|---|---|
| alles ablegen | URL ins Chatfenster ziehen, oder „importiere https://… in die bibliothek“, oder 📥 → „Prüfen & ablegen“ |
| nur schauen, nichts schreiben | „prüf den inhalt von https://…“, 📥 → „Nur prüfen“ (läuft über `persist:false` + `text_preview`) |
| Text einer Datei ins Wissen | Datei (.md/.txt/.pdf) ins Chatfenster ziehen |
| Einzelnes Asset erschließen | 📥 Katalog → „📚 Bibliothek“ am Asset (Prüfung + RAG-Eintrag, maskiert) |
| ohne verlinkte Software | „importiere <url> in die bibliothek, nur seite“ |

Der Bibliothekseintrag enthält Titel, Quelle, Abrufzeit, Kurzinfo (Meta-Description oder erste
Sätze), Gliederung, bereinigten Volltext und die Liste der verlinkten Dateien — damit ist die
Seite über „suche im wissen: …“ wieder auffindbar und im Chat kontextgebend.

Demo zum Ausprobieren (liegt im Repo und wird vom Dev-Server ausgeliefert):
`http://127.0.0.1:5173/demo/seite/index.html` → ziehen, „Prüfen & ablegen“, danach
`suche im wissen: türsensor abfrage`.

**Neu am Gateway:** `POST /import` mit `persist:false` (und `GET /import/preview?url=`)
liefern im Eintrag zusätzlich `text_preview` (bis 120 000 Zeichen, `null`-frei, bei
Binärinhalten weggelassen) – nur so ist „Nur prüfen“ wirklich rückwirkungsfrei.

### Grenzen (bewusst benannt)

* **PWA über https**: `http://192.168.x.x:8791` ist Mixed Content – der Browser blockt.
  Dann läuft die App über die Bridge (same-origin `/gateway/*`, Dev-Proxy bzw. Reverse
  Proxy) oder muss im Netzwerk https/TLS am Gateway bekommen. In der **nativen Hülle**
  entfällt das (eigener HTTP-Stack, Cleartext laut Network Security Config erlaubt).
* Der Service Worker mischt nicht mit: gecacht werden nur `/assets/*` und die App-Shell;
  `/gateway/*`, `/mcp/*` und Fremd-Origin-Anfragen gehen immer ins Netz (`public/sw.js`).
* UDP-Broadcast kommt nicht über Router-VLANs/Great-Wall-artige Segmentierung durch –
  deshalb gibt es den /24-Sweep, die manuelle Eingabe und `extraHosts`.
* Der Browser-Direktimport (Fallback ohne Gateway) braucht CORS am Ziel und landet
  **nicht** im Server-Katalog; große Dateien bleiben dort im Speicher der Seite.

---

## 3. Verifizieren

```bash
# Gateway + Discovery + Grabber im Selbsttest (14 Prüfungen)
python3 mobile-server/mobile_ble_server.py selftest
#   ✅ portview-udp-announce … portview-http-probe … grabber-import
#   ✅ grabber-katalog+datei · grabber-dedupe-sha · grabber-ssrf-filter

python3 mobile-server/tests/test_gateway.py      # 32 Tests (PortView, Grabber, Ingest-Helfer)
cd desktop && python3 -m unittest discover -s tests   # 44 Tests (PortView, Grabber, Seiten-Ingest)

# Seiten-Ingest ohne UI durchspielen (Gateway + Demo-Seite müssen laufen):
curl -s -X POST http://127.0.0.1:8791/import -H 'content-type: application/json' \
     -d '{"url":"http://127.0.0.1:8123/demo/seite/index.html","persist":false}' | head -c 300

# Live, mit laufendem Gateway (--mock):
curl -s http://127.0.0.1:8791/status | python3 -m json.tool | head -6
npm run mcp:portview
curl -s -X POST http://127.0.0.1:8791/import -H 'content-type: application/json' \
     -d '{"url":"http://127.0.0.1:8791/status"}'
curl -s http://127.0.0.1:8791/imports | python3 -m json.tool | head -20
```

Für die App: `npm run dev:full`, dann im Browser das 🧭-Panel öffnen – dort muss
„Gateway 127.0.0.1:8791 · Bridge 127.0.0.1:8790“ mit niedriger Latenz stehen, und das
📥-Panel muss das Demo-Pack importieren (3 Assets, ein Dedupe-Hinweis beim zweiten Lauf).
