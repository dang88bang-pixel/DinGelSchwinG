# DinGelSchwinG v3.0 – Agent Console (Desktop, Python/CustomTkinter)

Chat-zentrierte Agenten-Steuerung für Netzwerk- und Systemadministration:

- 💬 **Chat-Bereich** – Messenger-Stil, Markdown-lite (fett/kursiv/Code/Listen), Enter zum Senden
- 🔘 **6 frei belegbare Aktionsbuttons** – per Chat belegen (`"Belege Button 3 mit dem Skript network_scan.py"`) oder manuell in den Einstellungen
- 📡 **Status-Panel** – Geräte, Clients, Workflows, Testverbindungen, Systemlast (Live via WebSocket `/ws/status` + Polling, mit Offline-Mock-Fallback)
- 🛠️ **Skripte-Galerie** – CRUD + eingebauter Editor, Testen/Ausführen mit Timeout, RBAC (nur `admin` darf löschen)
- ⚙️ **Einstellungen** – Systeminstruktionen (System-Prompt), Modell-Backend, Button-Belegung
- 🧠 **Eingebettetes Lightweight-Modell** – Qwen2.5-0.5B-Instruct (GGUF ~400 MB) oder Ollama/OpenAI-kompatibel; ohne LLM läuft eine deterministische Skill-Engine (immer funktionsfähig)

## Installation & Start

```bash
pip install -r requirements.txt        # customtkinter (+ optional websocket-client)
python main.py                          # Login (admin / admin)
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

## Tests

```bash
python -m unittest discover -s tests -v     # 23 Tests, ohne GUI
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
│                           # script_executor, skill_loader, model_backend, config
├── tools/download_model.py # GGUF-Download (Qwen2.5-0.5B-Instruct)
├── data/
│   ├── skillz.md           # Skill-Definitionen (vom Agenten geladen)
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
