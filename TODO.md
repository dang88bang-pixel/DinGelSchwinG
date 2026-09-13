# TODO — offene & teilfertige Punkte

**Stand: 2026-09-13 · Quelle: [`GAP_MATRIX.md`](GAP_MATRIX.md) Fassung 2.0 (§ 12 Rest-Gaps `G-*`,
§ 14.3 Aktionsketten `A-*`) + Befundtabelle `INVENTAR.csv` (411 Dateien, 4 Nicht-REAL)**

Diese Liste ist die **Arbeitsliste** des Projekts. Jeder Eintrag nennt Ist-Zustand, Ziel,
konkrete Schritte und — wichtig — den **Nachweis**, mit dem der Punkt als erledigt gilt.
Nichts hier ist „gefühlt offen": jeder Eintrag hat eine Zeile in der GAP-Matrix und wurde
am 2026-09-13 gegen den Arbeitsbaum geprüft.

**Legende Status:** `offen` = nicht begonnen · `teilfertig` = Grundgerüst real, Teil fehlt ·
`blockiert` = braucht Hardware/SDK/Toolchain/externe Daten · `n/a` = Spec-Abweichung, bewusst nicht gebaut
**Priorität:** `P1` = funktional, hier im Repo umsetzbar · `P2` = braucht Toolchain/Netz/CI/Daten ·
`P3` = Doku/Tech-Debt · `B` = externer Blocker

## Schnellübersicht

| ID | Titel | Status | Prio | Aufwand |
|---|---|---|---|---|
| [A-2](#a-2-workflow-registry) | Workflow-Registry (nur `scan_network` echt) | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-1](#a-1-skript-runner-im-backend) | Skript-Runner im Backend (nur `network_scan.py`) | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-10](#a-10--g-2-enterprise-knoten-an-ui-anbinden) | Enterprise-Knoten an UI anbinden | **erledigt ✅ 2026-09-13** | P1 | S |
| [A-3](#a-3-llm-kette-multi-turn) | LLM-Kette: Multi-Turn statt 1 Durchgang / max. 5 Tools | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-7](#a-7-ingest--grabber-offline-pfad) | Ingest/Grabber ohne Gateway (Offline-Pfad) | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-6](#a-6-freie-button-aktionen-taskcustom) | Freie Button-Aktionen (`task:custom`) | **erledigt ✅ 2026-09-13** | P1 | S |
| [A-5](#a-5-adb-ausführung-aus-dem-web) | ADB-Ausführung aus dem Web (Server-Proxy mit Träger) | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-12](#a-12-demo-geräteliste-im-desktop-kennzeichnen) | Demo-Geräteliste im Desktop kennzeichnen | **erledigt ✅ 2026-09-13** | P1 | S |
| [G-5](#g-5--a-9-default-port-8765-entflechten) | Default-Port 8765 entflechten (= A-9) | **erledigt ✅ 2026-09-13** | P1 | S |
| [G-9](#g-9-bundle-splitting) | Bundle-Splitting (Chunk > 500 kB) | **erledigt ✅ 2026-09-13** | P1 | M |
| [A-8](#a-8--g-4-3d-raycast-entscheiden) | 3D-Raycast: implementieren **oder** entfernen (= G-4) | **erledigt ✅ 2026-09-13** | P1 | S–L |
| [G-1](#g-1-enterprise-knoten-produktivbestand) | Enterprise-Knoten: Produktivbestand einpflegen | offen | P2 | S |
| [G-3](#g-3-fastboot-binary) | `fastboot`-Binary statt 542-B-Platzhalter | teilfertig | P2 | S |
| [G-6](#g-6-wasm-artefakt-bauen) | `.wasm`-Artefakt bauen (Rust/wasm-pack) | teilfertig | P2 | M |
| [V-1](#v-1-docker--nginx-verifizieren) | Docker-Stack + NGINX-Konfig verifizieren | offen | P2 | S |
| [G-8](#g-8-android--genesis-build-lokal) | Android-/Genesis-Build lokal (SDK) | blockiert | P2 | M |
| [G-7](#g-7-ct45p-xon-protokoll-feldabgleich) | CT45P-Xon+-GATT: Feldabgleich | blockiert | B | L |
| [G-10](#g-10--a-4-upstream-mcp-paket) | Upstream-MCP: 5 Tools „not implemented" | blockiert | B | – |
| [N-1](#n-1--a-11-audio-loopback-und-jni) | Audio-Loopback / JNI-Callbacks | n/a | B | – |
| [D-1](#d-1-doku-pflegen) | Doku-Pflege (README/INDEX nach Änderungen) | offen | P3 | S |

---

## P1 — funktional, ohne externe Abhängigkeit umsetzbar

### A-2 Workflow-Registry
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix A-2 (§ 14.3)
- **Betroffen:** `server/workflows.py` (neu), `config/workflows.json` (neu), `server/app.py`
  (`POST /api/workflows`, `GET /api/workflows/registry`), `src/lib/api/client.ts`,
  `src/lib/agent/agentEngine.ts` (`runWorkflowViaBackend`), `src/components/OperationsCenter.tsx`,
  `desktop/utils/agent.py` + `desktop/utils/status_manager.py` (`workflow:*` meldet ehrlich `queued`)
- **Ist (vorher):** Nur `scan_network` (Alias `network_scan`, `scan`) führte echte Arbeit aus,
  alles andere antwortete mit **501**; der Web-Button trug fremde Workflows als `queued` ein.
- **Ziel:** Mehrstufige Workflows serverseitig mit echtem Fortschritt.
- **Umgesetzt:**
  - [x] Workflow-Definitionen als Daten: `config/workflows.json` (3 Workflows, Parameter mit
        Regex-Mustern; unbekannte Parameter → **400** `PARAMS_NOT_ALLOWED`)
  - [x] `WORKFLOW_IMPL` entfernt — `server/workflows.py` führt Schritte sequenziell mit `progress`
        aus (`builtin` = In-Prozess-Handler, `script` = gepinnter Whitelist-Subprocess)
  - [x] `GET /api/workflows` liefert `steps[]` (Status, Dauer, Detail, `exitCode`, `error`),
        `GET /api/workflows/registry` liefert die Definitionen
  - [x] Web-Button `workflow:<name>` ruft `POST /api/workflows` und zeigt echte Schritte;
        undefinierte Workflows bleiben **501**, ohne Backend bleibt der Task `queued`
  - [x] Desktop: `workflow:<name>` trägt einen `queued`-Eintrag mit Begründung ein statt
        „✅ gestartet“ zu behaupten (`workflow:scan` läuft weiterhin echt im Hintergrund)
  - [x] `docs/openapi.yaml` nachgezogen (`server/tests/test_api_contract.py` 5/5)
- **Fertig wenn:** `curl -X POST …/api/workflows -d '{"name":"<neu>"}'` echte Schritte mit
  `progress` liefert **und** `python3 tests/suite.py` + `make test-py` grün bleiben.
- **Nachweis:** `python3 server/tests/test_scripts_workflows.py`, `python3 tests/suite.py`
  (**failed: 0** gegen laufendes Backend), `npm test`. `POST /api/workflows` mit
  `{"name":"host_health"}` liefert `status: success`, `progress: 100` und ≥ 2 Skript-Schritte mit
  `exitCode: 0`; `deploy_all` liefert weiterhin **501**, `subnet=../../etc` liefert **400**.

### A-1 Skript-Runner im Backend
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix A-1
- **Betroffen:** `server/script_runner.py` (neu), `server/data/scripts/` (neu: `manifest.json`,
  `port_report.py`, `disk_report.py`), `scripts/pin-server-scripts.py` (neu), `server/app.py`
  (`GET /api/scripts`, `POST /api/scripts/run`), `src/components/OperationsCenter.tsx`
- **Ist (vorher):** Serverseitig lief nur `network_scan.py`; jedes andere Skript bekam **501**.
  Echte Skripte liefen nur in der Desktop-Konsole.
- **Ziel:** Whitelist-basierte Skript-Ausführung im Backend.
- **Umgesetzt:**
  - [x] Skript-Whitelist + Ablage `server/data/scripts/` mit SHA-256-Pinning
        (`kind: script` = Subprocess, `kind: builtin` = In-Prozess, braucht Server-Zustand)
  - [x] Ausführung mit Timeout, Argument-Mustern je Parameter, Ausgabe-Cap und `argv`-Übergabe
        (kein Shell-Inject); manipulierte Datei → **409**, fremdes Skript → **501**
  - [x] Audit-Eintrag je Lauf inkl. Exit-Code (`run_script … exit=0/2`)
  - [x] `OperationsCenter.tsx`: Skript- und Workflow-Auswahl aus `GET /api/scripts` bzw.
        `GET /api/workflows/registry` statt fester Vorgabe, Aufrufe mit `Authorization`
  - [x] Pins nachziehbar/prüfbar: `python3 scripts/pin-server-scripts.py [--check]`
- **Fertig wenn:** Ein zweites, whitelist-gelistetes Skript per API läuft (Exit-Code im Audit) und
  ein nicht gelistetes weiterhin 501 liefert (Test in `server/tests/`).
- **Nachweis:** `python3 server/tests/test_scripts_workflows.py` (23 Tests), `python3 tests/suite.py`
  (**failed: 0**): `disk_report.py` und `port_report.py` laufen per API mit `exitCode: 0`,
  fehlerhafte Argumente → **400**, nicht gelistete Skripte → **501**, Exit-Code steht im Audit.

### A-10 / G-2 Enterprise-Knoten an UI anbinden
- **Status:** ✅ **erledigt 2026-09-13** (**G-2** ist derselbe Punkt) · **Quelle:** GAP-Matrix A-10 / G-2 / 1.20
- **Betroffen:** `src/config/enterprise-nodes.ts` (`probeAllNodes`, `formatNodeProbe`,
  `formatNodeBatch`, `findNodeCategory`, `PROBE_REASON_LABEL`), `src/components/EnterpriseNodesPanel.tsx`
  (neu), `src/components/NetworkDashboard.tsx`, `src/config/skills.ts`, `src/lib/agent/agentEngine.ts`,
  `server/nodes.py` (neu), `server/app.py` (`GET /api/nodes/validate?node=`), `desktop/utils/nodes.py`
  (neu), `desktop/utils/agent.py`, `desktop/data/skillz.md`, `docs/openapi.yaml`
- **Ist (vorher):** Die Probe war real (HEAD→GET, Timeout, ehrliche Gründe), aber **kein Panel**
  rief sie auf; `/api/nodes/validate` prüfte nur das eigene Backend.
- **Ziel:** Knoten-Status sichtbar und prüfbar.
- **Umgesetzt:**
  - [x] Panel `EnterpriseNodesPanel.tsx` (im `NetworkDashboard` nach dem Operations-Center) listet
        `getAllNodeConfigs()` mit Probe-Ergebnis, Status-Pill, Latenz, Grund und Fehlerdetail;
        probt automatisch beim Öffnen und umschaltbar **Browser-Probe** (`probeAllNodes()`) oder
        **Backend-Probe** (`GET /api/nodes/validate?node=<kategorie>`)
  - [x] Agent-Skill `node_status` in `src/config/skills.ts` + `executeToolLine`-Mapping und
        Chat-Erkennung (`intentNodeStatus`); Desktop gespiegelt (`data/skillz.md`,
        `_intent_node_status`, `desktop/utils/nodes.py` nutzt dieselbe Server-Logik)
  - [x] `GET /api/nodes/validate?node=<kategorie|knoten-id|all>` probt serverseitig den Bestand
        aus `config/enterprise-nodes.csv`; **ohne** Parameter bleibt die bisherige Selbstprüfung
        (`scope: self`), unbekannter Knoten → `reason: unknown-node`, `timeout=abc` → **400**
  - [x] `docs/openapi.yaml` nachgezogen (`test_api_contract.py` 5/5)
- **Ehrlichkeit:** Der Bestand enthält Planungs-Hosts (`*.qloud.local`) — Panel, Chat-Antwort und
  API nennen in dem Fall den echten Grund (`network-error`) und verweisen auf
  [G-1](#g-1-enterprise-knoten-produktivbestand); ein grüner Haken wird nicht erfunden.
- **Fertig wenn:** `grep -rn "enterprise-nodes" src/components` ≥ 1 Treffer und der neue Test
  in `src/config/__tests__/enterpriseNodes.test.ts` den UI-Pfad abdeckt.
- **Nachweis:** `grep -rn "enterprise-nodes" src/components` = 2 Treffer
  (`EnterpriseNodesPanel.tsx`, Import in `NetworkDashboard.tsx`);
  `src/config/__tests__/enterpriseNodes.test.ts` deckt Batch-Probe, Textfassung, Kategorie-Erkennung
  **und** die UI-/Agent-/Backend-Anbindung ab (`npm test`); `server/tests/test_node_probe.py` probt
  gegen einen lokalen HTTP-Dienst 200, 405→GET-Fallback, 503, Timeout, Netzfehler und nicht
  probbares Schema (`python3 -m unittest discover -s server/tests`); `python3 tests/suite.py`
  **failed: 0** mit 7 neuen Knoten-Checks gegen das laufende Backend.

### A-3 LLM-Kette: Multi-Turn
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix A-3
- **Betroffen:** `src/lib/agent/agentEngine.ts` (`tryLLM`, `buildToolFeedback`,
  `LLM_LOOP_LIMITS`), `desktop/utils/agent.py` (`_try_llm`, `_build_tool_feedback` — Spiegel),
  `src/lib/rag.ts` (`tokenize`, `MAX_QUERY_CHARS` — beim Testen gefunden, siehe unten)
- **Ist (vorher):** Ein Durchgang; maximal **5** `TOOL:`-Zeilen wurden ausgeführt, ihre Ergebnisse
  gingen **nicht** zurück ins Modell.
- **Ziel:** Werkzeug-Ergebnisse rückkoppeln (Agent-Loop) mit klarem Abbruch.
- **Umgesetzt:**
  - [x] Loop mit `maxTurns` (3) und Token-Budget (24 000, Schätzung über `estimateTokens()` aus
        `liveMetrics`); Grenzen sind als `LlmLoopLimits`-Objekt je Aufruf enger fassbar
  - [x] Tool-Ergebnisse als Kontext: `buildToolFeedback()` hängt je Turn `TOOL:`/`ERGEBNIS:`-Blöcke
        an, gekürzt auf 1 200 Zeichen und mit `maskSecrets()` bereinigt (Passwort-/Key-Muster
        werden als `[… – MASKIERT]` übergeben)
  - [x] Vier Abbruchkriterien: keine `TOOL:`-Zeile · `maxTurns` erreicht · dieselbe Zeile
        wiederholt · Budget gesprengt; jeder Lauf schreibt `llm_turns`
        (`turns=… tools=… tokens=… stop=…`) ins Audit, Modell-Fehler weiterhin `llm_error`
  - [x] Antwort kennzeichnet den Loop ehrlich (`🔁 Modell-Loop: N Turns … beendet: <Grund>`),
        bei `turns=0` wird der Grund genannt statt einer leeren Antwort
  - [x] Desktop gespiegelt (`_try_llm` mit denselben Konstanten/Gründen) — Web und Konsole
        bleiben, wie im Projekt üblich, gleichauf
  - [x] Tests: `src/lib/agent/__tests__/llmLoop.test.ts` (12) und
        `desktop/tests/test_llm_loop.py` (12) mit Skript-Backend, das erst nach dem
        Werkzeug-Ergebnis antwortet
- **Nebenbefund (gefunden und geschlossen):** `tokenize()` in `src/lib/rag.ts` nutzte einen
  verschachtelten Quantor ohne Längengrenze — eine lange Trennzeichen-freie Eingabe
  (400 000 Zeichen, z. B. ein eingefügter Base64-Block) lief **84 Sekunden** in exponentielles
  Backtracking. Jetzt: `{1,64}`-Grenzen (66 ms, gleiche Treffer) plus `MAX_QUERY_CHARS = 20 000`
  in `search()`; abgesichert durch `src/lib/__tests__/ragTokenize.test.ts` (5 Tests).
- **Fertig wenn:** Der neue Test einen 2-Turn-Lauf nachweist und `npm test` grün ist.
- **Nachweis:** `llmLoop.test.ts` weist den 2-Turn-Lauf nach (zweiter Prompt enthält
  `ERGEBNIS:` + `LLM_CONTINUE_HINT`, Audit `turns=2 tools=1`); `npm test` **73/73**,
  `python3 -m unittest discover -s desktop/tests` **82/82**, `make test-py` grün.

### A-7 Ingest-/Grabber-Offline-Pfad
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix A-7
- **Betroffen:** `src/lib/pageIngest.ts`, `src/lib/grabber.ts` (`grabFromFile`),
  `src/lib/assetStore.ts`, `src/lib/packs.ts`, `src/components/AssetGrabberPanel.tsx`,
  `src/lib/agent/agentEngine.ts` (`ingestDroppedFile`), `desktop/utils/page_ingest.py`
  (`ingest_file`), `desktop/utils/agent.py`, Skill-Doku (`skills.ts`, `skillz.md`)
- **Ist (vorher):** Ohne Gateway/Bridge antworteten beide Ketten strukturiert mit Fehler
  (kein Fake) — aber es gab keinen lokalen Weg.
- **Ziel:** Ingest/Katalog ohne Gateway.
- **Umgesetzt:**
  - [x] `ingestPage({ file })` / `ingestPage({ text })` arbeiten rein lokal: Asset-Store
        (IndexedDB) + RAG-Bibliothek, Quelle **`via: 'lokal'`** in Gutachten, Prüfpunkten
        (`Quelle abrufbar: lokal · <mime>`) und Chat-Report (`… · via lokal`)
  - [x] Grabber: `grabFromFile(file)` als Alternative zu `POST /gateway/import` — SHA-256,
        Kategorie-Erkennung, MIME aus der Endung, 32-MiB-Grenze, Pack-Manifeste werden abgelegt
        und ihre Items ehrlich als `skipped` (brauchen Netz) gemeldet; ohne IndexedDB sagt die
        Antwort, dass das Asset nur für diese Sitzung bleibt
  - [x] UI: Drop-Zone „Datei-Drop (ohne Gateway)“ + `Pill` „Quelle: lokal“ im 📥-Panel;
        Drag & Drop im Chatfenster übergibt jetzt die Datei selbst (`ingestPage({ file, text })`),
        damit sie zusätzlich im Asset-Store landet
  - [x] Fehlerpfad bleibt ehrlich und nennt den lokalen Weg: `grabFromUrl` offline →
        Hinweis „Datei ziehen statt URL (rein lokale Ablage)“
  - [x] Markdown-Tauglichkeit (beide Spiegel): `extractReadable()`/`extract_readable()` erkennen
        ATX-Überschriften, wenn kein HTML-Titel vorhanden ist — gezogene `.md`/`.txt`-Dateien
        heißen nicht mehr „Ohne Titel“ und bekommen eine Gliederung
  - [x] Desktop gespiegelt: `page_ingest.ingest_file(pfad)` + Chat-Intent
        („importiere datei <pfad> in die bibliothek“, „nur prüfen: datei <pfad>“), Audit
        `page_ingest_file`, Skill-Doku in `desktop/data/skillz.md`
  - [x] Tests: `src/lib/__tests__/offlineIngest.test.ts` (13, `fetch` offline gestubbt) und
        `desktop/tests/test_offline_ingest.py` (11)
- **Grenze (bleibt):** `mobile-server/importer.py` ist der Online-Weg (SSRF-Filter, 64 MiB,
  Katalog) und braucht weiterhin Netz/Werksnetz; verlinkte Dateien aus einem lokalen Dokument
  werden deshalb nur **genannt**, nicht nachgeladen.
- **Fertig wenn:** `npm test` einen Ingest **ohne** Gateway-Antwort als `ok` mit Quelle `lokal` ausweist.
- **Nachweis:** `offlineIngest.test.ts` prüft genau das (Ingest per Text und per Datei: `ok`,
  `review.via === 'lokal'`, Bibliothekseintrag auffindbar) — `npm test` **86/86**;
  `python3 -m unittest discover -s desktop/tests` **93/93**.

### A-6 Freie Button-Aktionen (`task:custom`)
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix A-6
- **Betroffen:** `src/lib/agent/agentEngine.ts` (`intentAssignButton`, `executeActionString`,
  `executeToolLine`), `src/config/skills.ts`, `desktop/data/skillz.md`, `desktop/utils/agent.py`
- **Ist (vorher):** `assign_button` ohne Skript/Workflow erzeugte `task:custom`; der Button
  erklärte sich selbst, führte aber nichts aus.
- **Ziel:** Freie Aktionen auf echte Skills/Endpoints abbilden.
- **Umgesetzt:**
  - [x] `assign_button` akzeptiert `skill=<name>` (gegen `SKILLS` geprüft) und legt `skill:<name>`
        auf den Button; unbekannte Skills werden abgelehnt statt still übernommen
  - [x] `executeActionString` führt `skill:<name>` über `executeToolLine` aus — jeder deklarierte
        Skill ist damit als Button-Aktion erreichbar
  - [x] Desktop gespiegelt: `_dispatch_tool_line` bedient dieselben Skills aus `data/skillz.md`
  - [x] Tests: Web (`actionChainCoverage.test.ts`: Button → Skill → Antwort, unbekannter Skill,
        jeder Skill aus `SKILLS` wird bedient) und Desktop (`test_skill_chain.py`)
- **Fertig wenn:** Der Test einen Button mit `skill:show_audit` belegt und die Audit-Antwort erhält.
- **Nachweis:** Der Test belegt einen Button mit `skill:show_audit` und erhält die Audit-Antwort;
  `npm test` und `python3 -m unittest discover -s desktop/tests` sind grün.

### A-5 ADB-Ausführung aus dem Web
- **Status:** ✅ **erledigt 2026-09-13** — Server-Proxy mit Träger-Pflicht · **Quelle:** GAP-Matrix A-5 (§ 14.3)
- **Betroffen:** `server/adb.py` (neu), `server/app.py` (`GET /api/adb/status`, `POST /api/adb/run`,
  `POST /api/adb/carrier`), `server/rbac.py` (`adb.read`/`adb.run`/`adb.carrier`),
  `src/lib/agent/adbCommand.ts` (neu), `src/lib/api/client.ts` (`runAdb`, `fetchAdbStatus`,
  `registerAdbCarrier`), `src/lib/agent/agentEngine.ts` (`intentAdbRunLive`, Freigabe-Zweig),
  `src/config/systemInstructions.ts` (Skill `adb_run`), `docs/openapi.yaml`, `docs/device-control.md` §4a
- **Ist (vorher):** Web **und** Desktop lieferten zur ADB-Kette einen **Plan + ein ausführbares Skript**
  (`adb_<art>_<zeitstempel>.sh`), führten die Aktionen aber selbst **nicht** aus: der Browser hat
  kein USB/ADB, die Desktop-Konsole schreibt nur die Datei.
- **Ziel:** Web kann ADB über einen freigegebenen Ausführer laufen lassen.
- **Umgesetzt:**
  - [x] `POST /api/adb/run` mit Whitelist (**10 Verben**: `devices`, `logcat`, `shell`, `pull`,
        `connect`, `disconnect`, `install`, `uninstall`, `reboot`, `tcpip`) — argv-Übergabe ohne
        Shell, Seriennummer-/Argument-Muster, Timeout je Verb (Deckel 180 s), Ausgabe-Cap
        20 000 Zeichen; `adb shell` nur mit Read-only-Befehlen (`getprop`, `pm list packages`,
        `dumpsys battery`, `ls`, `df`, …), Datei-Argumente (`pull`/`install`) bleiben in
        `server/data/adb/` (kein `..`, kein Absolutpfad)
  - [x] Ausführung **nur** mit Träger: `adb`-Binary auf dem Backend-Host (`NEXUS_ADB=/pfad` oder
        PATH-Suche) oder registrierter entfernter Host (`POST /api/adb/carrier`, nur mit
        `NEXUS_ADB_REMOTE=1`, TTL 120 s). Ohne Träger → **501** `KEIN_ADB_TRAEGER`; die Web-Seite
        bleibt dann beim Plan + Skript und nennt den lokal ausführbaren Befehl
  - [x] Freigabe & RBAC: Risiko-Verben (`install`, `uninstall`, `reboot`, `tcpip`) → **403**
        `FREIGABE_NOETIG` ohne `approve=true`; im Chat legt `adb reboot bootloader` erst den
        Umsetzungsplan an und läuft nach „freigeben“ (`adb.run` ab service, `adb.read` ab operator,
        `adb.carrier` ab service)
  - [x] Audit je Aufruf: `adb_run` mit `<verb>: exit=<code> <grund>` (bzw. Ablehnungsgrund) und
        `adb_carrier` bei Registrierung; die Antwort zeigt Exit-Code, `argv`, Träger (`local`/
        `remote`), Dauer und Ausgabe — Fehler-Exit-Codes werden nicht zu Erfolg
  - [x] Web-Kette: `parseAdbCommand()` macht aus „adb -s <serial> logcat lines=200 tag=System“
        den Request, `intentAdbRunLive()` zeigt den echten Befund; Verben außerhalb der Whitelist
        (z. B. `adb backup`, `adb push`) laufen weiterhin über Plan + Skript
  - [x] Doku: `docs/openapi.yaml` (33 → **36 Pfade**), `docs/device-control.md` §4a mit
        Verb-Tabelle, Träger-Einrichtung und Träger-Vertrag; Smoke-Checks in `tests/suite.py`
  - [x] Tests: `server/tests/test_adb_proxy.py` (**32** — Fake-`adb` mit echten Exit-Codes und
        echtem Timeout, entfernter Träger per HTTP-Stub, RBAC-Matrix, Live-Endpunkte inkl. Audit)
        und `src/lib/agent/__tests__/adbProxy.test.ts` (**16** — Satz→Antrag, Ausführung mit
        Träger, Freigabe-Dialog, 501 → Plan + Skript)
- **Grenze (bleibt):** Ein **Ausführer auf der Desktop-/Host-Seite** (Träger-Endpunkt, der die
  übergebene `argv` wirklich laufen lässt) ist nicht gebaut — der Vertrag ist dokumentiert und
  per HTTP-Stub getestet. `adb backup`/`adb push` bleiben bewusst außerhalb der Whitelist.
- **Fertig wenn:** Ohne Träger weiterhin Plan/Skript (Test), mit Träger ein echter Exit-Code im Audit steht.
- **Nachweis:** Ohne Träger: `test_ausfuehrung_ohne_traeger_bleibt_501` (501 `KEIN_ADB_TRAEGER`,
  kein Exit-Code) + `adbProxy.test.ts` „erfindet ohne Träger keine Geräte und keinen Exit-Code“
  (Antwort enthält `Kein ADB-Träger`, `adb devices -l`, aber keinen `Exit-Code n`). Mit Träger:
  `test_devices_laeuft_mit_exit_code_0_und_audit` findet `adb_run … devices: exit=0` im Audit —
  live nachvollzogen mit `NEXUS_ADB=<fake-adb>` auf Port 5001 (`exitCode: 0`,
  `argv: ["…/adb","devices","-l"]`, Audit `adb_run admin ok | devices: exit=0 exit-code`).
  Stände: `npm test` **102/102** · `server/tests` **90/90** · `desktop/tests` **93/93** ·
  `tests/suite.py` + `tests/chain.py` **failed: 0** · `npm run lint`/`build` grün.

### A-12 Demo-Geräteliste im Desktop kennzeichnen
- **Status:** ✅ **erledigt 2026-09-13** (neu gefunden und sofort geschlossen, § 14.4) ·
  **Nachweis:** `TestAdbDevicesFallback` (2 Zweige) in `desktop/tests/test_skill_chain.py` — 62/62;
  Ausgabe trägt jetzt `⚠️ **Beispiel** (keine echte Abfrage: kein ADB-Träger erreichbar)`,
  Audit `demo – kein ADB-Träger erreichbar`; Negativkontrolle ohne Kennzeichnung → FAILED
- **Quelle:** GAP-Matrix A-12 (§ 14.3 / § 14.4)
- **Betroffen:** `desktop/utils/agent.py` (`_intent_adb_devices`)
- **Ist:** Ohne `_clients` bzw. wenn die Live-Abfrage mit `⚠️` antwortet, liefert der Desktop eine
  **feste Beispielliste** (`R58M123ABC – Pixel 7`, `192.168.1.42:5555 – Galaxy S21`) ohne
  „Beispiel"-Kennzeichnung; das Audit vermerkt „Geräteliste abgefragt". Die Web-Variante
  (`intentAdbDevices`, `src/lib/agent/agentEngine.ts:521`) nennt stattdessen die Browser-Grenze.
- **Ziel:** Keine ungekennzeichneten Demo-Daten in der Kette.
- **Schritte:**
  - [ ] Fallback als „Beispiel (kein Gerät erreichbar)" kennzeichnen **oder** durch Hinweis ersetzen
  - [ ] `self._audit("adb_devices", "demo")` statt „Geräteliste abgefragt"
  - [ ] Test in `desktop/tests/test_skill_chain.py`: Fallback-Antwort enthält das Kennzeichen
- **Fertig wenn:** `python3 -m unittest discover -s desktop/tests` grün ist **und** der Fallback-Text
  das Wort „Beispiel" enthält.

### G-5 / A-9 Default-Port 8765 entflechten
- **Status:** ✅ **erledigt 2026-09-13** (`PTY_PORT`-Default 8765 → **8768**, Gateway bleibt 8765) ·
  **Nachweis:** `TestPortDefaults` (3 Tests, liest die Defaults aus dem echten Modulcode) — 18/18;
  live liefen `python3 -m server.pty_bridge` und `npm run mcp:gateway` gleichzeitig
  (`0.0.0.0:8768` + `0.0.0.0:8765` offen, WS-Handshake `101`). Nachgezogen: `start.sh`,
  `vite.config.ts`, `docker-compose.yml`, `deploy/nginx.conf`, `Dockerfile`,
  `deploy/.env.example`, promtail-Kommentar, README (5), `api-websockets.md` (3),
  `hardware-setup.md` (2) — GAP-Matrix § 14.4
- **Quelle:** GAP-Matrix G-5 / A-9 / 10.2
- **Betroffen:** `server/pty_bridge.py` (`PTY_PORT`, Default 8765), `mobile-server/gw_config.py` (`DGS_TCP_PORT`, Default 8765), `README.md`, `docs/api-websockets.md`, `deploy/*`, `docker-compose.yml`
- **Ist:** Beide Dienste belegen standardmäßig 8765 → parallel nur mit Env-Override
  (im Test `PTY_PORT=8770` genutzt).
- **Ziel:** Keine Default-Kollision.
- **Schritte:**
  - [ ] `PTY_PORT`-Default auf 8768 ändern (Gateway behält 8765)
  - [ ] `README.md`, `docs/api-websockets.md`, `deploy/nginx.conf`, `docker-compose.yml`, `deploy/monitoring/*` nachziehen
  - [ ] `server/tests/test_discovery.py`: Test, dass beide Defaults verschieden sind
  - [ ] `vite.config.ts`-Proxy `/api/ws/terminal` anpassen
- **Fertig wenn:** `bash start.sh --backend-only` **und** `npm run mcp:gateway` gleichzeitig laufen
  (beide Ports offen) und der neue Test grün ist.

### G-9 Bundle-Splitting
- **Status:** ✅ **erledigt 2026-09-13** · **Quelle:** GAP-Matrix G-9
- **Betroffen:** `vite.config.ts`, `scripts/check-bundle.mjs` (neu), `src/components/Scene3D.tsx`
  (Aufrufer `NetworkDashboard.tsx`), `src/components/PairingPanel.tsx`
- **Ist (vorher):** `vite build` warnte: `index` 1,94 MB, `transformers.web` 883 kB (> 500 kB).
- **Ziel:** Kleinere Erstladung.
- **Umgesetzt:**
  - [x] `manualChunks` für `three`/`@react-three`, `transformers`/`onnx`, Charts und QR-Code;
        `hoistTransitiveImports: false` + `resolveDependencies`-Filter gegen Modulepreload-Bloat
  - [x] `Scene3D` per `React.lazy` + `Suspense` (3D-Dashboard ist nicht Startansicht)
  - [x] `html5-qrcode` dynamisch in `PairingPanel.tsx`; `qrcode.react` entfernt (ungenutzt)
  - [x] Budget-Wächter `scripts/check-bundle.mjs` (läuft nach `npm run build`): initial ≤ 500 kB,
        Einzel-Chunk ≤ 520 kB, gesamt ≤ 700 kB — sonst Build-Fehler
- **Fertig wenn:** `npm run build` keine Chunk-Warnung mehr ausgibt (Zahl im Commit nennen).
- **Nachweis:** `npm run build` ohne Chunk-Warnung; Erstladung **659,86 kB** (gzip **203,71 kB**)
  — 626,90 kB direkt nach dem Split, +26 kB durch A-10-Knotenpanel und A-7-Drop-Zone,
  +6,85 kB durch die A-5-ADB-Kette (`adbCommand.ts`, `runAdb`, `intentAdbRunLive`).
  Vorher: 1 940 kB. Größter Einzel-Chunk `three` ≈ 390 kB (nur 2 Module, nicht weiter teilbar),
  `vendor-transformers` 497 kB als Lazy-Chunk. `node scripts/check-bundle.mjs` grün.

### A-8 / G-4 3D-Raycast entscheiden
- **Status:** ✅ **erledigt 2026-09-13** — Variante A (entfernen) ·
  **Quelle:** GAP-Matrix A-8 / G-4 / 6.9 · `INVENTAR.csv` `[STUB]`
- **Betroffen:** `genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/RaycastUtil.kt`
  (`perform3DRaycast()` → `null`, Zeile 34, **ohne Aufrufer**), `…/ui/HitTest.kt` (real, 2D)
- **Ist (vorher):** Dummy für einen Filament-3D-Pfad, den es nicht gibt; der reale Pfad ist 2D.
- **Ziel:** Entweder echt oder weg — kein toter Stub.
- **Umgesetzt (Variante A, Aufwand S):**
  - [x] `RaycastUtil.kt` gelöscht (`git rm`); `screenToNdc` bleibt in `HitTest.kt`, dessen KDoc
        den 2D-Pfad als einzigen beschreibt
  - [x] Audit-Sonderfall aus `scripts/audit_inventar.py` entfernt, `README`/Doku nachgezogen
  - [x] `INVENTAR.csv` neu erzeugt (`make inventar`) → `[STUB]`-Eintrag für die Datei ist weg
- **Variante B (Filament + Slab-Test)** bleibt bewusst unbaut: kein 3D-Renderer im Projekt,
  Android-SDK/Gradle fehlen in der Arbeitsumgebung (siehe [G-8](#g-8-android--genesis-build-lokal)).
- **Fertig wenn:** `python3 scripts/audit_inventar.py` für diese Datei keinen `STUB`-Befund mehr meldet.
- **Nachweis:** `python3 scripts/audit_inventar.py` meldet für `RaycastUtil.kt` keinen Befund mehr
  (Datei existiert nicht); einziger verbleibender `[STUB]` ist der by-design Vite-Alias
  `src/lib/agent/onnxRuntimeNodeStub.ts`.

---

## P2 — braucht Toolchain, Netz, CI oder Daten

### G-1 Enterprise-Knoten: Produktivbestand
- **Status:** offen · **Quelle:** GAP-Matrix G-1 / 1.20 · `INVENTAR.csv` `[TODO] config/enterprise-nodes.csv`
- **Betroffen:** `config/enterprise-nodes.csv` (5 Planungs-Knoten `*.qloud.local`), `src/config/enterprise-nodes.ts`
- **Ist:** Die Konfiguration ist strukturell vollständig, enthält aber Planungs-Hosts —
  Proben laufen daher erwartbar ins Leere.
- **Schritte:**
  - [ ] Echte Knoten (ID, Endpoint, Protokoll, Auth, Zweck) vom Betrieb liefern lassen
  - [ ] CSV + `ENTERPRISE_NODES` synchron aktualisieren und `docs/enterprise-node-database.md` nachziehen
  - [ ] `make test-py` + `npm test` (Probe-Tests bleiben grün)
- **Fertig wenn:** `probeNodeEndpoint()` gegen einen echten Knoten `http-ok` liefert (Nachweis als Curl/Log).

### G-3 `fastboot`-Binary
- **Status:** teilfertig · **Quelle:** GAP-Matrix G-3 / 4.1 · `INVENTAR.csv` `[PLACEHOLDER]`
- **Betroffen:** `android/app/src/main/assets/devicecontrol/fastboot` (542 B Text), `scripts/fetch-android-tools.sh`, CI-Schritt „Fetch Device-Control binaries"
- **Ist:** `adb` ist ein echtes ELF (5 142 600 B), `fastboot` ein Platzhalter; die App meldet eine
  Handlungsanweisung statt abzustürzen. Fetch in der Sandbox nicht möglich
  (`dl.google.com`/Termux per TLS blockiert; nur GitHub/PyPI/npm erreichbar).
- **Schritte:**
  - [ ] Auf einer Maschine mit Netz: `ADB_URL=… FASTBOOT_URL=… bash scripts/fetch-android-tools.sh`
  - [ ] SHA-256 + ELF-Prüfung protokollieren, Lizenz-/Herkunftsdatei ergänzen
  - [ ] APK neu bauen (CI) und `fastboot --version` auf Gerät prüfen
- **Fertig wenn:** `file android/.../fastboot` → `ELF 64-bit … ARM aarch64` und `INVENTAR.csv` keinen Platzhalter mehr meldet.

### G-6 WASM-Artefakt bauen
- **Status:** teilfertig · **Quelle:** GAP-Matrix G-6 / 1.16 · `INVENTAR.csv` `[PLACEHOLDER] public/wasm/README.txt`
- **Betroffen:** `wasm-ble/` (Rust-Crate), `public/wasm/` (leer), `src/lib/bleWasm.ts` (JS-Fallback), CI-Schritt „Build BLE WASM"
- **Ist:** Kein Rust/crates.io in der Sandbox → der Glue-Loader nutzt die verifizierte JS-Simulation.
- **Schritte:**
  - [ ] Lokal/CI: `rustup target add wasm32-unknown-unknown && wasm-pack build --target web`
  - [ ] Artefakt nach `public/wasm/` legen, `bleWasm.ts` lädt es (Pfad-Check vorhanden)
  - [ ] Vergleichstest: WASM- vs. JS-Ergebnis (Pfadverlust) auf 1e-6 gleich
- **Fertig wenn:** `ls public/wasm/*.wasm` eine Datei zeigt und der Vergleichstest grün ist.

### V-1 Docker- & NGINX-Verifizierung
- **Status:** offen (in der Sandbox nicht ausführbar) · **Quelle:** GAP-Matrix 8.1 / 8.2
- **Betroffen:** `Dockerfile`, `docker-compose.yml` (api/terminal/discovery/status/web), `deploy/nginx.conf`, `deploy/monitoring/*`
- **Ist:** Konfigurationen liegen vor und wurden gelesen, aber **nicht ausgeführt**
  (kein Docker-Daemon, kein `nginx` in der Sandbox).
- **Schritte:**
  - [ ] `docker compose config` + `docker compose up` auf einem Host mit Docker
  - [ ] `nginx -t` gegen `deploy/nginx.conf`
  - [ ] Monitoring-Stack: Targets `:5000`/`:8790`/`:8791` in Prometheus „UP"
  - [ ] Ergebnis (Ausgaben) in `GAP_MATRIX.md` § 11 nachtragen
- **Fertig wenn:** Die drei Prüfungen protokolliert sind und die Zeilen 8.1/8.2 von ⛔ auf ✅ wechseln.

### G-8 Android-/Genesis-Build lokal
- **Status:** blockiert (CI läuft) · **Quelle:** GAP-Matrix G-8 / 4.6 / 6.10
- **Betroffen:** `android/`, `genesis-orchestrator/android-app/`, `.github/workflows/build-apk.yml`
- **Ist:** Kein SDK/Gradle/Kotlin-Compiler in der Sandbox; CI baut die Haupt-App
  (Run 34734972974 auf diesem Zweig: **success**, 5 m 34 s). Für die Genesis-App existiert kein Workflow.
- **Schritte:**
  - [ ] Instrumented-/Unit-Tests der Haupt-App in CI aufnehmen (`testDebugUnitTest`)
  - [ ] Eigenen Workflow oder Matrix-Job für `genesis-orchestrator/android-app` anlegen
- **Fertig wenn:** CI beide Apps baut **und** `testDebugUnitTest` grün meldet.

---

## B — externe Blocker (nicht durch Code allein lösbar)

### G-7 CT45P-Xon+-Protokoll: Feldabgleich
- **Status:** blockiert · **Quelle:** GAP-Matrix G-7 / 3.9
- **Ist:** GATT-UUIDs/Charakteristiken sind dokumentierte **Annahmen**; Krypto, Whitelist,
  Lockout und Tamper-Logik sind real und getestet (47/47 + Selftest 24/24),
  aber ohne echten Scanner nicht verifizierbar.
- **Schritte:**
  - [ ] Mit echtem CT45P Xon+ GATT-Dump aufnehmen (nRF Connect) und UUIDs abgleichen
  - [ ] `mobile-server/honeywell.py` ggf. anpassen, Selftest um reale Frames erweitern
- **Fertig wenn:** Ein echter Lesevorgang `granted` im Audit-Log erzeugt (Nachweis: `sessions.json`).

### G-10 / A-4 Upstream-MCP-Paket
- **Status:** blockiert (Fremdpaket) · **Quelle:** GAP-Matrix G-10 / A-4
- **Ist:** `@cristianoaredes/mcp-mobile-server` meldet 5 Registry-Tools als „not implemented"
  (`flutter_performance_profile`, `flutter_deploy_pipeline`, `android_full_debug`,
  `ios_simulator_manager`, `flutter_inspector_session`).
- **Schritte:**
  - [ ] Upstream-Issue öffnen bzw. Version prüfen
  - [ ] Bis dahin: diese 5 Tools in der UI als „upstream: nicht implementiert" kennzeichnen
- **Fertig wenn:** `npm run mcp:list` die Tools als verfügbar meldet **oder** die UI sie klar ausweist.

### N-1 / A-11 Audio-Loopback und JNI
- **Status:** n/a (dokumentierte Spec-Abweichung) · **Quelle:** GAP-Matrix 10.3 / 10.4 / A-11
- **Ist:** Keine Audio-Pipeline und kein JNI im Repo; USB/BT-Pfade haben Timeouts + Error-Handling.
- **Schritte:** nur bei neuer Anforderung — dann SHA-256-Abgleich der Loopback-Aufnahme und
  JNI-Timeout-Tests einplanen.
- **Fertig wenn:** nicht anwendbar, solange keine Audio-/JNI-Anforderung besteht —
  Eintrag bleibt als dokumentierte Abweichung stehen.

---

## P3 — Doku & Pflege

### D-1 Doku pflegen
- **Status:** offen · **Quelle:** Befunde dieser Runde (README-Abhängigkeiten, `server/requirements.txt`)
- **Ist:** Zwei Doku-Aussagen waren falsch und wurden korrigiert (xterm/Flask/PyJWT-Liste,
  „Audit in-memory"). Drift entsteht leicht weiter.
- **Schritte:**
  - [ ] Nach jeder API-Änderung: `docs/openapi.yaml` + `README.md` + `docs/INDEX.md` prüfen
  - [ ] `python3 server/tests/test_api_contract.py` (Spec ⇄ Code ⇄ Frontend) läuft in `make test-py`
  - [ ] `python3 server/tests/test_todo_consistency.py` hält diese TODO-Liste zur GAP-Matrix synchron
  - [ ] `make inventar` nach jeder größeren Änderung (Nicht-REAL-Befunde aktuell halten)
- **Fertig wenn:** Beide Konsistenz-Tests grün sind und `INVENTAR.csv` zum Commit passt.

---

## Anhang — Nicht-REAL-Befunde aus `INVENTAR.csv`

`python3 scripts/audit_inventar.py` meldet 411 Dateien, davon 4 Nicht-REAL. Jeder Befund hat
hier einen Eintrag — damit kein Marker unbemerkt liegen bleibt:

| Befund | Datei | TODO-ID | Bewertung |
|---|---|---|---|
| `PLACEHOLDER` | `android/app/src/main/assets/devicecontrol/fastboot` | [G-3](#g-3-fastboot-binary) | echtes Binary fehlt |
| `TODO` | `config/enterprise-nodes.csv` | [G-1](#g-1-enterprise-knoten-produktivbestand) | Planungs-Hosts |
| `PLACEHOLDER` | `public/wasm/README.txt` | [G-6](#g-6-wasm-artefakt-bauen) | `.wasm`-Artefakt fehlt |
| `STUB` | `src/lib/agent/onnxRuntimeNodeStub.ts` | — (kein Arbeitspunkt) | **bewusst:** Vite-Alias
  (`vite.config.ts:12`), damit das native `onnxruntime-node` nicht gebündelt wird; Browser nutzt
  `onnxruntime-web`. Entfernen würde den Build brechen. |

---

## Zuletzt geschlossen (deshalb **nicht** mehr offen)

Zur Abgrenzung — diese Punkte waren offen und sind seit dem 2026-09-13 erledigt
(Nachweise in `GAP_MATRIX.md` § 13/§ 13.1/§ 14.2):

`POST /api/scan` 404 · `POST /api/scripts/run` 500 · `GET /api/diagnostics/iperf` 404 ·
Pairing-Spec-Pfade + `/api/devices-status` (Phantom-Spec) · `openapi.yaml` 20 → 31 Pfade ·
`validateNodeEndpoint()`-Stub · Web-Tool-Kette 14/30 → **30/30** · Desktop-Tool-Kette 18/37 → **37/37** ·
`gateway_grant`-`None` · Skill-Duplikate (`skills.ts`, `skillz.md`) ·
Fake-`success` in `workflow:<name>`, `POST /api/workflows`, `POST /api/scripts/run` ·
Desktop-Test-Isolation + `DGS_API_URL` · Frontend-Test-Isolation ·
**A-12** Demo-Geräteliste gekennzeichnet · **G-5/A-9** Port 8765 entflechtet (Terminal 8768) ·
**A-8/G-4** toter 3D-Raycast entfernt (`RaycastUtil.kt`, `[STUB]`-Befund weg) ·
**G-9** Bundle gesplittet (Erstladung 1 940 kB → **659,86 kB**, Budget-Wächter `scripts/check-bundle.mjs`) ·
**A-1** Skript-Whitelist im Backend (SHA-256-Pins, `server/script_runner.py`) ·
**A-2** Workflow-Registry (`config/workflows.json`, `server/workflows.py`, `steps[]` mit Exit-Codes) ·
**A-6** freie Button-Aktionen `skill:<name>` (Web + Desktop) ·
**A-10/G-2** Enterprise-Knoten an UI, Agent und `GET /api/nodes/validate?node=` angebunden ·
**A-3** Modell-Loop mit Werkzeug-Rückkopplung (max. 3 Turns, Token-Budget, Audit `llm_turns`) ·
`tokenize()`-Backtracking in `src/lib/rag.ts` (84 s → 66 ms bei 400 000 Zeichen) ·
**A-7** Ingest/Grabber ohne Gateway: `grabFromFile()`, `ingest_file()`, Quelle `lokal`,
Drop-Zone im 📥-Panel, Markdown-Titel/Gliederung in beiden Spiegeln ·
**A-5** ADB-Ausführung aus dem Web: `server/adb.py` (10 Whitelist-Verben, argv ohne Shell),
`POST /api/adb/run` + `/api/adb/carrier`, `GET /api/adb/status`, Träger-Pflicht (501 ohne Träger),
Audit `adb_run` mit Exit-Code, Chat-Kette `parseAdbCommand()` → `intentAdbRunLive()` ·
Teststände: `npm test` 36/36 → **102/102** · `server/tests` 18 → **90** · `desktop/tests` 62 → **93** ·
`tests/suite.py` **failed: 0** · Watchdog/Log-Rotation/Bug-Reports · Gateway-Session-Persistenz ·
Genesis-`/graph` + Polar-Switch.

## Pflege dieser Liste

```bash
python3 server/tests/test_todo_consistency.py   # jede G-*/A-*-ID der GAP-Matrix steht hier
make test-py                                    # läuft zusammen mit den Unit-Suites
make inventar                                   # Nicht-REAL-Befunde aktuell halten
```

Neue Punkte: erst in `GAP_MATRIX.md` (mit Nachweis) aufnehmen, dann hier mit ID, Ist, Ziel,
Schritten und „Fertig wenn" eintragen — der Konsistenz-Test schlägt sonst fehl.
