# DinGelSchwinG v3.0 – Agent Console (Desktop, Python/CustomTkinter)

Chat-zentrierte Agenten-Steuerung für Netzwerk- und Systemadministration:

- 💬 **Chat-Bereich** – Messenger-Stil, Markdown-lite (fett/kursiv/Code/Listen), Enter zum Senden
- 🔘 **6 frei belegbare Aktionsbuttons** – per Chat belegen (`"Belege Button 3 mit dem Skript network_scan.py"`) oder manuell in den Einstellungen
- 📡 **Status-Panel** – Geräte, Clients, Workflows, Testverbindungen, Systemlast (Live via WebSocket `/ws/status` + Polling, mit Offline-Mock-Fallback)
- 🛠️ **Skripte-Galerie** – CRUD + eingebauter Editor, Testen/Ausführen mit Timeout, RBAC (nur `admin` darf löschen)
- ⚙️ **Einstellungen** – Systeminstruktionen (System-Prompt), Modell-Backend, Button-Belegung
- 🧠 **Eingebettetes Lightweight-Modell** – Qwen2.5-0.5B-Instruct (GGUF ~400 MB) oder Ollama/OpenAI-kompatibel; ohne LLM läuft eine deterministische Skill-Engine (immer funktionsfähig)
- 🖼️ **Agenten-Gallerie** – 13 Profile (Installieren/Aktivieren/Deinstallieren, JSON-Import/-Export) in `data/agent_gallery.json` + `data/gallery_state.json`; das aktive Profil wird in den System-Prompt injiziert
- 🧭 **PortView** – dieselbe Automatik wie in der App: `utils/clients.py` sucht Host + Port
  des Mobile-Servers per UDP-Broadcast (`:18791`) und HTTP-Probe, sobald die konfigurierte
  Adresse nicht antwortet (`portview_status()`, Chat-Intent `portview`; aus mit `DGS_PORTVIEW=0`,
  übersprungen wenn `DGS_GATEWAY_URL` gesetzt ist)
- 🧲 **Seiten-Ingest** – `utils/page_ingest.py`: Seite ziehen, Inhalt prüfen (lesbarer Text,
  Gliederung, Skript-Anteil, Secret-Muster, Duplikat), dann Seite als Asset, verlinkte Software
  und ein `data/knowledge/`-Dokument ablegen; `format_ingest_report()` liefert den Chat-Text.
  Chat: „prüf den inhalt von <url>“ (schreibt nichts) bzw. „importiere <url> in die bibliothek“
- 📥 **Software-Grabber** – `import_url()`, `list_imports()`, `delete_import()`,
  `import_asset_path()`, `describe_imports()` sprechen die `/import`-Endpunkte des Gateways
  (Beats, Samples, UI-Styles, Effekte, Filter; Dedupe per SHA-256, SSRF-Filter);
  Chat-Intent: `importiere http://…/dgs-demo-pack.json als styles`
- 📚 **Wissensdatenbank (RAG)** – `data/knowledge/*.md|txt`, BM25-ähnliche Bewertung (identisch zur Web-App), Treffer landen automatisch im LLM-Kontext
- 🔌 **MCP & 🔐 BLE-Gateway** – Schnellzugriff-Buttons über den 6 Aktionsbuttons; Brücke zu `mcp/bridge.mjs` (:8790) und `mobile-server/` (:8791), reine Standardbibliothek, offline-tolerant
- 📊 **Live-Kennzahlen + Kurzzeit-Cache** – Läufe, Zeit, Tokens, Kosten, Cache-Trefferquote; identische Läufe werden 8 s lang bedient (`⚡ Aus dem Laufzeit-Cache`) und an die Bridge gemeldet

## Installation & Start

```bash
cd desktop
pip install -r requirements.txt        # customtkinter (+ optional websocket-client)
python main.py                          # Login (admin / admin)

# alternativ vom Repo-Root (Paket-Aufruf):
python3 -m desktop.main
```

Beide Aufrufarten funktionieren – die `views/*` importieren deshalb absolut
(`utils.…`) mit Fallback vom Paketmodus aus. Ohne `data/config.json` werden
Sinn-Einstellungen erzeugt; `requirements.txt` braucht für die MCP-/Gateway-Skills
**keine** zusätzlichen Pakete.

## Agent-Modi (Systemanweisung konfigurierbar)

Der Agent arbeitet in **konfigurierbaren Modi** – Wechsel unter
**Einstellungen → System**, der Text der Systemanweisung ist dort direkt editierbar:

| Modus | Beschreibung |
|---|---|
| **A: Normaler Chat** | Allgemeine verbindliche Systemanweisung (Anforderungsanalyse, Pflichtprozess, Code-Regeln, Kommunikation) |
| **B: ADB-Aktion** | ADB-spezialisierte Anweisung (USB/WiFi · Pentesting · Rescue · Backup). Eigene ADB-Skills (`skillz_adb.md`). **Pflicht-Freigabeprozess:** Bei risikobehafteten Aktionen wird zuerst ein Umsetzungsplan vorgelegt – erst nach „freigeben“ wird das vollständige, ausführbare Skript erzeugt (in `data/scripts/adb_*.sh`). |
| **Benutzerdefiniert** | Eigene Anweisung frei definierbar |

Dateien: `data/system_instruction_chat.txt`, `data/system_instruction_adb.txt`,
`data/system_instruction_custom.txt` (wird beim Speichern angelegt), `data/skillz_adb.md`.

Beispiel-Dialog Modus B:
```
» erstelle ein adb backup skript
  📋 Umsetzungsplan (Modus B – ADB-Aktion: backup) … Vor Ausführung ist deine
     ausdrückliche Freigabe erforderlich. Antworte mit „freigeben“.
» freigeben
  ✅ Skript erstellt: adb_backup_20260812_103000.sh (Pfad: data/scripts/…)
```

## Modell einbinden (optional)

**Variante A – eingebettetes GGUF-Modell (empfohlen):**

```bash
pip install llama-cpp-python
python tools/download_model.py          # lädt Qwen2.5-0.5B-Instruct Q4_K_M (~400 MB) nach data/models/
```

Danach in der GUI: **Einstellungen → Modell → Auto** (erkennt das Modell automatisch).

**Variante B – Ollama:**

```bash
ollama pull qwen2.5:0.5b                # oder ollama pull qwen2.5
```

In der GUI: Einstellungen → Modell → `ollama`.

**Variante C – OpenAI-kompatible API:** Einstellungen → Modell → `openai` + Key/URL.

Ohne Modell antwortet der Agent mit der eingebauten Skill-Engine (offline, deterministisch).

## MCP-Tools, BLE-Gateway, Gallerie & Wissen (_parität zur Web-App_)

Voraussetzung ist die Bridge (`npm run mcp:bridge` im Repo-Root, Port 8790) – das Gateway
(`npm run mcp:gateway`, Port 8791) nur für die Token-Pfade. Ohne beide Dienste antworten die
Skills mit klarem Offline-Hinweis statt Fehler.

| Befehl (Chat) | Wirkung |
|---|---|
| `mcp verbinden` · `mcp status` | Bridge + MCP-Server prüfen (31 Tools), Gateway-Reichweite |
| `mcp tools gateway` | Tool-Katalog durchsuchen |
| `mcp tool=health_check verbose=true` | einzelnes Tool aufrufen (Ergebnis gekürzt, Cache) |
| `gateway status` · `gateway whitelist` · `gateway sessions` | Zähler, Freischaltungen, letzte Lesevorgänge |
| `demo-handshake` · `ble_scan` · `gateway selbsttest` | Krypto-Durchlauf, BLE-Scan, In-Prozess-Test |
| `token CT45P-0001 uid 04:A2:B3:C1:D2:E3 authentisieren` | Whitelist-Prüfung → Challenge (oder `delegated`) |
| `freigabe für sid S6AA… erteilen` · `deny für sid …` | Ergebnis im delegated-Modus zurückmelden |
| `gallerie` · `gallerie android` · `installiere agent ble-security` | Agenten-Gallerie |
| `lern: Rufnummern: 0221 555` · `suche im wissen: batteriewarnung` | Wissensbasis schreiben/lesen |
| `portview` · `finde den server-port` | Mobile-Server automatisch aufspüren (PortView) |
| `importiere http://…/pack.json als styles` | URL-Import in den Asset-Katalog (Grabber) |
| `prüf den inhalt von http://…` | Seiten-Gutachten ohne Ablage (Ingest) |
| `importiere http://… in die bibliothek` | Seite + verlinkte Software + Wissensbasis-Dokument |
| `dashboard` · `leere den cache` · `exportiere das log als json` | Kennzahlen, Cache, Export |

Die Schnellzugriffsleiste (über den sechs Aktionsbuttons) sendet dieselben Befehle:
**🖼️ Agenten · 🔌 MCP · 📡 Gateway · 📊 Dashboard · 📚 Wissen · 🔐 Token**.

### Agent-Nachweis (`agent_proof`) signieren

Nutzt das Gateway `--require-agent-proof 1`, müssen Lesungen signiert werden. Die Konsole tut das
automatisch, sobald ein geteiltes Geheimnis sichtbar ist – `DGS_AGENT_SHARED_SECRET` (64 Hex) oder
`desktop/data/keys.json` mit `{"shared_secret": "…"}` (Vorlage: `mobile-server/keys.example.json`).
Das Signieren passiert in `utils/clients.py::sign_agent_request`; die Root-Keys der Tokens bleiben
am Haupt-Agenten bzw. im Vault und werden hier nie benötigt.

```bash
python3 ../mobile-server/honeywell_keys.py create --keys data/keys.json --token-id CT45P-0001
```

## Tests

```bash
python -m unittest discover -s tests -v     # 30 Tests, ohne GUI
cd ../mobile-server && python3 tests/test_gateway.py     # 25 Prüfungen (Gateway/Krypto)
```

## Backend-Anbindung

Die Konsole fragt ein optionales Backend auf `localhost:5000` ab
(`/api/devices`, `/api/clients`, `/api/workflows`, `/api/tests`, `/api/system`,
WebSocket `/ws/status`). Ist kein Backend erreichbar, liefert ein eingebauter
Mock-Datenprovider plausible Daten – die Oberfläche bleibt voll funktionsfähig
(erkennbar an „(mock)“ in der Status-Bar).

## Projektstruktur

```
desktop/
├── main.py                 # Login + Hauptfenster
├── views/                  # chat, dashboard, scripts, settings, status_panel
├── utils/                  # agent, api_client, ws_client, status_manager,
│                           # script_executor, skill_loader, model_backend, config,
│                           # clients (MCP/Gateway), agentGallery (Profile + RAG)
├── tools/download_model.py # GGUF-Download (Qwen2.5-0.5B-Instruct)
├── data/
│   ├── skillz.md           # Skill-Definitionen (27, vom Agenten geladen)
│   ├── agent_gallery.json  # exportierter Katalog aus src/config/agentGallery.ts
│   ├── gallery_state.json  # installiert/aktiv (laufzeit, nicht versioniert)
│   ├── knowledge/            # RAG-Dokumente (.md/.txt, nicht versioniert)
│   ├── system_instruction.txt
│   └── scripts/            # Skripte-Galerie (network_scan.py, backup_config.sh, …)
└── tests/                  # Headless-Tests (23)
```

## Chat-Beispiele

```
» zeige alle Geräte
» scannen 192.168.1.0/24
» wer ist eingeloggt?
» belege Button 3 mit dem Skript network_scan.py
» exportiere das Log als csv
» leere den Cache
» hilfe
```
