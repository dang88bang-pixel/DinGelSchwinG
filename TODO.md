# TODO — offene & teilfertige Punkte

**Stand: 2026-09-13 · Quelle: [`GAP_MATRIX.md`](GAP_MATRIX.md) Fassung 2.0 (§ 12 Rest-Gaps `G-*`,
§ 14.3 Aktionsketten `A-*`) + Befundtabelle `INVENTAR.csv` (390 Dateien, 5 Nicht-REAL)**

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
| [A-2](#a-2-workflow-registry) | Workflow-Registry (nur `scan_network` echt) | teilfertig | P1 | M |
| [A-1](#a-1-skript-runner-im-backend) | Skript-Runner im Backend (nur `network_scan.py`) | teilfertig | P1 | M |
| [A-10](#a-10--g-2-enterprise-knoten-an-ui-anbinden) | Enterprise-Knoten an UI anbinden | teilfertig | P1 | S |
| [A-3](#a-3-llm-kette-multi-turn) | LLM-Kette: Multi-Turn statt 1 Durchgang / max. 5 Tools | offen | P1 | M |
| [A-7](#a-7-ingest--grabber-offline-pfad) | Ingest/Grabber ohne Gateway (Offline-Pfad) | offen | P1 | M |
| [A-6](#a-6-freie-button-aktionen-taskcustom) | Freie Button-Aktionen (`task:custom`) | teilfertig | P1 | S |
| [A-5](#a-5-adb-ausführung-aus-dem-web) | ADB-Ausführung aus dem Web (nur Plan/Skript) | n/a im Browser | P1 | M |
| [A-12](#a-12-demo-geräteliste-im-desktop-kennzeichnen) | Demo-Geräteliste im Desktop kennzeichnen | **erledigt ✅ 2026-09-13** | P1 | S |
| [G-5](#g-5--a-9-default-port-8765-entflechten) | Default-Port 8765 entflechten (= A-9) | **erledigt ✅ 2026-09-13** | P1 | S |
| [G-9](#g-9-bundle-splitting) | Bundle-Splitting (Chunk > 500 kB) | offen | P1 | M |
| [A-8](#a-8--g-4-3d-raycast-entscheiden) | 3D-Raycast: implementieren **oder** entfernen (= G-4) | teilfertig | P1 | S–L |
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
- **Status:** teilfertig · **Quelle:** GAP-Matrix A-2 (§ 14.3)
- **Betroffen:** `server/app.py` (`WORKFLOW_IMPL`, `POST /api/workflows`), `src/lib/agent/agentEngine.ts` (`executeActionString`, `workflow:*`)
- **Ist:** Nur `scan_network` (Alias `network_scan`, `scan`) führt echte Arbeit aus, alles andere
  antwortet ehrlich mit **501**. Der Web-Button trägt fremde Workflows als `queued` ein und
  sagt, wo sie wirklich laufen.
- **Ziel:** Mehrstufige Workflows serverseitig mit echtem Fortschritt.
- **Schritte:**
  - [ ] Workflow-Definitionen (Schritte, Skript/Endpoint, Timeout) als Daten, z. B. `config/workflows.json`
  - [ ] `WORKFLOW_IMPL` durch Registry-Lookup ersetzen; Schritte sequenziell mit `progress` ausführen
  - [ ] `GET /api/workflows` liefert Schritt-Details (`steps[]`, `error`)
  - [ ] Web-Button `workflow:<name>` ruft `POST /api/workflows` und zeigt echten Fortschritt statt `queued`
  - [ ] `docs/openapi.yaml` nachziehen
- **Fertig wenn:** `curl -X POST …/api/workflows -d '{"name":"<neu>"}'` echte Schritte mit
  `progress` liefert **und** `python3 tests/suite.py` + `make test-py` grün bleiben.

### A-1 Skript-Runner im Backend
- **Status:** teilfertig · **Quelle:** GAP-Matrix A-1
- **Betroffen:** `server/app.py` (`SCRIPT_IMPL`, `POST /api/scripts/run`), `desktop/data/scripts/`
- **Ist:** Serverseitig läuft nur `network_scan.py`; jedes andere Skript bekommt **501**
  (vorher: jedes Skript lieferte ein Scan-Ergebnis). Echte Skripte laufen nur in der Desktop-Konsole.
- **Ziel:** Whitelist-basierte Skript-Ausführung im Backend.
- **Schritte:**
  - [ ] Skript-Whitelist + Ablage (`server/data/scripts/`) mit SHA-256-Pinning
  - [ ] Ausführung mit Timeout, Argument-Validierung, Ausgabe-Cap (kein Shell-Inject)
  - [ ] Audit-Eintrag je Lauf (bereits vorhanden: `store.audit("run_script", …)`) um Exit-Code ergänzen
  - [ ] `src/components/OperationsCenter.tsx`: Skriptliste aus `/api/scripts` statt fester Vorgabe
- **Fertig wenn:** Ein zweites, whitelist-gelistetes Skript per API läuft (Exit-Code im Audit) und
  ein nicht gelistetes weiterhin 501 liefert (Test in `server/tests/`).

### A-10 / G-2 Enterprise-Knoten an UI anbinden
- **Status:** teilfertig (**G-2** ist derselbe Punkt) · **Quelle:** GAP-Matrix A-10 / G-2 / 1.20
- **Betroffen:** `src/config/enterprise-nodes.ts` (`probeNodeEndpoint()`, 9 Tests), `server/app.py` (`GET /api/nodes/validate`)
- **Ist:** Die Probe ist real (HEAD→GET, Timeout, ehrliche Gründe), aber **kein Panel** ruft sie auf;
  `/api/nodes/validate` prüft nur das eigene Backend.
- **Ziel:** Knoten-Status sichtbar und prüfbar.
- **Schritte:**
  - [ ] Panel (oder Abschnitt im Operations-Center) listet `getAllNodeConfigs()` + Probe-Ergebnis
  - [ ] Agent-Skill `node_status` in `src/config/skills.ts` + `executeToolLine`-Mapping
  - [ ] `/api/nodes/validate` optional gegen echte Knoten (Parameter `node=`), sonst Selbstprüfung
- **Fertig wenn:** `grep -rn "enterprise-nodes" src/components` ≥ 1 Treffer und der neue Test
  in `src/config/__tests__/enterpriseNodes.test.ts` den UI-Pfad abdeckt.

### A-3 LLM-Kette: Multi-Turn
- **Status:** offen · **Quelle:** GAP-Matrix A-3
- **Betroffen:** `src/lib/agent/agentEngine.ts` (`tryLLM`, `slice(0, 5)`)
- **Ist:** Ein Durchgang; maximal **5** `TOOL:`-Zeilen werden ausgeführt, ihre Ergebnisse gehen
  **nicht** zurück ins Modell.
- **Ziel:** Werkzeug-Ergebnisse rückkoppeln (Agent-Loop) mit klarem Abbruch.
- **Schritte:**
  - [ ] Loop mit `maxTurns` (z. B. 3) und Token-Budget aus `liveMetrics`
  - [ ] Tool-Ergebnisse als Kontext anhängen (gekürzt, ohne Secrets)
  - [ ] Abbruch bei Wiederholung/Fehler + Audit-Eintrag `llm_turns`
  - [ ] Test: Mock-Backend, das erst nach Tool-Ergebnis antwortet
- **Fertig wenn:** Der neue Test einen 2-Turn-Lauf nachweist und `npm test` grün ist.

### A-7 Ingest-/Grabber-Offline-Pfad
- **Status:** offen · **Quelle:** GAP-Matrix A-7
- **Betroffen:** `src/lib/pageIngest.ts`, `src/lib/grabber.ts`, `mobile-server/importer.py`
- **Ist:** Ohne Gateway/Bridge antworten beide Ketten strukturiert mit Fehler (kein Fake) —
  aber es gibt keinen lokalen Weg.
- **Ziel:** Ingest/Katalog ohne Gateway.
- **Schritte:**
  - [ ] `ingestPage` ohne Gateway: nur RAG + Asset-Store (IndexedDB), klar gekennzeichnet
  - [ ] Grabber: Datei-Drop als Alternative zu `POST /gateway/import`
  - [ ] Tests für beide Offline-Pfade (Vitest, `fetch` gestubbt)
- **Fertig wenn:** `npm test` einen Ingest **ohne** Gateway-Antwort als `ok` mit Quelle `lokal` ausweist.

### A-6 Freie Button-Aktionen (`task:custom`)
- **Status:** teilfertig · **Quelle:** GAP-Matrix A-6
- **Betroffen:** `src/lib/agent/agentEngine.ts` (`intentAssignButton`, `executeActionString`)
- **Ist:** `assign_button` ohne Skript/Workflow erzeugt `task:custom`; der Button erklärt sich
  jetzt selbst, führt aber nichts aus.
- **Ziel:** Freie Aktionen auf echte Skills/Endpoints abbilden.
- **Schritte:**
  - [ ] `assign_button` akzeptiert `skill=<name>` und legt `skill:<name>` auf den Button
  - [ ] `executeActionString` führt `skill:<name>` über `executeToolLine` aus
  - [ ] Test in `actionChainCoverage.test.ts`: Button → Skill → Antwort
- **Fertig wenn:** Der Test einen Button mit `skill:show_audit` belegt und die Audit-Antwort erhält.

### A-5 ADB-Ausführung aus dem Web
- **Status:** n/a im Browser (Design-Grenze), offen als Server-Proxy · **Quelle:** GAP-Matrix A-5 (§ 14.3)
- **Betroffen:** `src/config/systemInstructions.ts` (`ADB_SKILLS`, 7 Skills ab Zeile 79),
  `src/lib/agent/agentEngine.ts` (`tryAdbIntents` → `_plan_adb` / `generateAdbScript`),
  `desktop/data/skillz_adb.md` (dieselben 8 Einträge) + `desktop/utils/agent.py` (`_generate_adb`),
  `android/app/src/main/assets/devicecontrol/adb` (5 142 600 B, ELF)
- **Ist:** Web **und** Desktop liefern zur ADB-Kette einen **Plan + ein ausführbares Skript**
  (`adb_<art>_<zeitstempel>.sh` in `scripts_dir`), führen die Aktionen aber selbst **nicht** aus:
  der Browser hat kein USB/ADB, die Desktop-Konsole schreibt nur die Datei. `adb_devices` fragt im
  Desktop live (`_clients.adb_devices()`, sonst Demo-Fallback → [A-12](#a-12-demo-geräteliste-im-desktop-kennzeichnen)),
  im Browser gibt es einen ehrlichen Hinweis (`intentAdbDevices`).
- **Ziel:** Web kann ADB über einen freigegebenen Ausführer laufen lassen.
- **Schritte:**
  - [ ] Backend-Endpunkt `POST /api/adb/run` (Whitelist-Verben, Geräte-Seriennummer, Timeout, Freigabe-Dialog)
  - [ ] Ausführung nur, wenn ein ADB-Träger (Desktop/Host) registriert ist — sonst weiterhin Plan + Skript
  - [ ] Audit je Aufruf (`store.audit("adb_run", …)`) und Anzeige des Exit-Codes
  - [ ] `docs/openapi.yaml` + `docs/device-control.md` nachziehen
- **Fertig wenn:** Ohne Träger weiterhin Plan/Skript (Test), mit Träger ein echter Exit-Code im Audit steht.

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
- **Status:** offen · **Quelle:** GAP-Matrix G-9
- **Betroffen:** `vite.config.ts`, `src/components/Scene3D.tsx`, `src/lib/agent/transformersBackend.ts`
- **Ist:** `vite build` warnt: `index` 1,94 MB, `transformers.web` 883 kB (> 500 kB).
- **Ziel:** Kleinere Erstladung.
- **Schritte:**
  - [ ] `build.rollupOptions.output.manualChunks` für `three`/`@react-three`
  - [ ] `Scene3D` per `React.lazy` laden (3D-Dashboard ist nicht Startansicht)
  - [ ] Prüfen, ob `html5-qrcode`/`qrcode.react` ebenfalls lazy gehen
- **Fertig wenn:** `npm run build` keine Chunk-Warnung mehr ausgibt (Zahl im Commit nennen).

### A-8 / G-4 3D-Raycast entscheiden
- **Status:** teilfertig · **Quelle:** GAP-Matrix A-8 / G-4 / 6.9 · `INVENTAR.csv` `[STUB]`
- **Betroffen:** `genesis-orchestrator/android-app/app/src/main/java/com/genesis/orchestrator/ui/RaycastUtil.kt`
  (`perform3DRaycast()` → `null`, Zeile 34, **ohne Aufrufer**), `…/ui/HitTest.kt` (real, 2D)
- **Ist:** Dummy für einen Filament-3D-Pfad, den es nicht gibt; der reale Pfad ist 2D.
- **Ziel:** Entweder echt oder weg — kein toter Stub.
- **Schritte (Variante A, entfernen — empfohlen, Aufwand S):**
  - [ ] `RaycastUtil.kt` löschen, `screenToNdc` bei Bedarf nach `HitTest.kt` übernehmen
  - [ ] `INVENTAR.csv` neu erzeugen (`make inventar`) → `[STUB]`-Eintrag verschwindet
- **Schritte (Variante B, implementieren — Aufwand L):**
  - [ ] Filament-Renderer + inverse View-Projection anbinden, Ray/AABB-Slab-Test
  - [ ] Kotlin-Unit-Test für den Slab-Test (CI mit SDK)
- **Fertig wenn:** `python3 scripts/audit_inventar.py` für diese Datei keinen `STUB`-Befund mehr meldet.

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

`python3 scripts/audit_inventar.py` meldet 390 Dateien, davon 5 Nicht-REAL. Jeder Befund hat
hier einen Eintrag — damit kein Marker unbemerkt liegen bleibt:

| Befund | Datei | TODO-ID | Bewertung |
|---|---|---|---|
| `PLACEHOLDER` | `android/app/src/main/assets/devicecontrol/fastboot` | [G-3](#g-3-fastboot-binary) | echtes Binary fehlt |
| `TODO` | `config/enterprise-nodes.csv` | [G-1](#g-1-enterprise-knoten-produktivbestand) | Planungs-Hosts |
| `STUB` | `genesis-orchestrator/…/ui/RaycastUtil.kt` | [A-8 / G-4](#a-8--g-4-3d-raycast-entscheiden) | toter Dummy |
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
Desktop-Test-Isolation + `DGS_API_URL` · Frontend-Test-Isolation · `npm test` (36/36) ·
**A-12** Demo-Geräteliste gekennzeichnet · **G-5/A-9** Port 8765 entflechtet (Terminal 8768) ·
Watchdog/Log-Rotation/Bug-Reports · Gateway-Session-Persistenz · Genesis-`/graph` + Polar-Switch.

## Pflege dieser Liste

```bash
python3 server/tests/test_todo_consistency.py   # jede G-*/A-*-ID der GAP-Matrix steht hier
make test-py                                    # läuft zusammen mit den Unit-Suites
make inventar                                   # Nicht-REAL-Befunde aktuell halten
```

Neue Punkte: erst in `GAP_MATRIX.md` (mit Nachweis) aufnehmen, dann hier mit ID, Ist, Ziel,
Schritten und „Fertig wenn" eintragen — der Konsistenz-Test schlägt sonst fehl.
