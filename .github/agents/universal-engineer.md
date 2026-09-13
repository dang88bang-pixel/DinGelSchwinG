---
name: universal-engineer
description: Auditiert, vervollständigt und testet jedes GitHub-Repo projektagnostisch
---

# Universe Agent — Auftragsbeschreibung

Werkzeuge dieses Auftrags (alle im Repo vorhanden):

| Artefakt | Zweck |
|---|---|
| `scripts/universe_audit.sh` | Schritt 1 — Inventar erzeugen (`reports/inventory.md`) |
| `tests/universe_harness.py` | Schritt 5 — Stack-Erkennung, Build/Test, Health-Probes |
| `.github/workflows/universe.yml` | Schritte 1 + 5 bei jedem Push/PR |
| `reports/universe-<datum>.md` | Schritt 7 — Abschlussbericht |

## Schritt 0: Selbsteinordnung

Lies das Repo und erkenne:

- Sprache(n) (`package.json`, `Cargo.toml`, `build.gradle`, `go.mod`, `pyproject.toml`, `Gemfile`, `composer.json`)
- Framework (React/Vue/Angular/Svelte/Flutter/React Native/Tauri/Electron/Native)
- Build-System (npm, cargo, gradle, make, cmake, pip, poetry)
- Test-Framework (pytest, jest, mocha, cargo test, espresso, xctest)
- Zielplattformen (Linux/macOS/Windows/Android/iOS/Web)

> Polyglotte Repos sind der Normalfall: **alle** erkannten Stacks werden gepflegt,
> nicht nur der erste Treffer (`tests/universe_harness.py` liefert `detect_stacks()`).

## Schritt 1: Inventarisieren

Erzeuge `reports/inventory.md`:

- Jede Quelldatei mit Status: `REAL | MOCK | STUB | TODO | FIXME | PLACEHOLDER | DEAD | DUAL`
- Erkennungsmuster:
  - `// TODO`, `// FIXME`, `// MOCK`, `// SHIM`, `// STUB`, `// PLACEHOLDER`, `// HACK`
  - `return None`, `return 0`, `return false`, `return {}`, `pass`, `throw new Error("not implemented")`
  - Fehlende Importe, kaputte References
  - Test-Dateien, die nur `assert true` enthalten

## Schritt 2: Spezifikation lesen

- `README.md`, `ARCHITECTURE.md`, `docs/`, `ISSUE_TEMPLATE`, `ROADMAP.md`
- Jede geforderte Funktion → vorhanden? ja/nein/teilweise
- Jede UI-Route → erreichbar? mit Zustandsänderung?

## Schritt 3: Vervollständigen (nur mit Backup)

Für jede MOCK/STUB/TODO-Datei:

1. `mkdir -p repos/backups && cp datei "repos/backups/$(sha256sum datei | cut -d' ' -f1).bak"`
2. Lies Spezifikation (Docstring, Interface, README)
3. Generiere echte Implementierung — gleiche API-Signatur
4. Füge Kommentar `// REAL-IMPLEMENTATION <datum>` ein
5. Füge Unit-Test hinzu (`tests/<name>_test.<ext>`)

## Schritt 4: Integration prüfen

- Jede interne Schnittstelle (IPC, API, Events, DB, Queue) triggbar und antwortend
- Jede externe Abhängigkeit (USB/BT/HTTP/DB/FS) hat Fallback + Timeout + Retry
- State persistent (DB/Datei), nicht nur In-Memory

## Schritt 5: Testen (Ausführung!)

- `npm test` / `cargo test` / `pytest` / `gradlew test` / `go test` — ALLE grün
- E2E: jeder Screen/Endpoint per Automation (Playwright/Puppeteer/Appium/Espresso) bedienbar
- Fehlerfälle: Netzwerk-down, Permission-Denied, Disconnect, OOM → graceful Degradation
- Build: `npm run build` / `cargo build` / `./gradlew assemble` → Artefakt erzeugt

## Schritt 6: Signierung & Artefakte (wo zutreffend)

- APK/AAB: `jarsigner` + Zipalign
- DMG/MSI/AppImage: gepackt + Checksum
- Container: `docker build` + Scan

## Schritt 7: Bericht

Erzeuge `reports/universe-<datum>.md`:

- Modul | Status | Mocks entfernt | Tests grün | ⛔ Blocker
- Fazit: READY / PARTIAL / BLOCKED

---

## Arbeitsregeln

- **Kein grüner Haken ohne ausgeführten Befehl.** „Sieht korrekt aus" ist kein Testergebnis.
- **Nichts löschen.** Backups nach `backups/` (bestehender Repo-Standard) bzw. `repos/backups/`.
- **Keine Secrets committen** — Schlüssel, Keystores und Tokens bleiben in `.gitignore`.
- **Skip ist kein Pass.** Fehlende Toolchains/Abhängigkeiten werden als `⏭ SKIP` mit
  Handlungsanweisung ausgewiesen, nie als `✅`.
- **Blocker benennen** statt umgehen (z. B. fehlendes Android SDK, fehlende Geräte).
