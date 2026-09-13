#!/usr/bin/env python3
"""SHA-256-Pins der Backend-Skript-Whitelist nachziehen / prüfen (Aktionskette A-1).

`server/data/scripts/manifest.json` ist die Whitelist: nur was dort steht, wird
von `POST /api/scripts/run` ausgeführt, und nur wenn der Hash der Datei zum Pin
passt. Nach jeder Änderung an einem Skript muss der Pin neu gesetzt werden —
sonst verweigert der Runner die Ausführung (409 INTEGRITY_FAILED) statt sie
stillschweigend durchzuwinken.

Aufruf:
    python3 scripts/pin-server-scripts.py            # Hashes nachziehen
    python3 scripts/pin-server-scripts.py --check    # nur prüfen (CI), exit 1 bei Drift
"""
from __future__ import annotations

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server.script_runner import MANIFEST_PATH, SCRIPTS_DIR, file_sha256  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="manifest.json-Pins pflegen")
    parser.add_argument("--check", action="store_true",
                        help="nicht schreiben, nur melden (Exit 1 bei Drift)")
    parser.add_argument("--manifest", default=MANIFEST_PATH)
    args = parser.parse_args()

    with open(args.manifest, encoding="utf-8") as fh:
        manifest = json.load(fh)

    drift: list[str] = []
    for entry in manifest.get("scripts", []):
        if entry.get("kind") != "script":
            continue
        name = entry.get("file") or entry.get("name")
        path = os.path.join(SCRIPTS_DIR, name)
        if not os.path.isfile(path):
            drift.append(f"{name}: Datei fehlt unter {os.path.relpath(SCRIPTS_DIR, ROOT)}")
            continue
        actual = file_sha256(path)
        pinned = str(entry.get("sha256") or "").lower()
        if pinned != actual:
            drift.append(f"{name}: Pin {pinned[:12] or '(leer)'}… → {actual[:12]}…")
            entry["sha256"] = actual

    if not drift:
        print(f"✅ {len(manifest.get('scripts', []))} Einträge, alle Pins aktuell.")
        return 0

    print("Pin-Drift festgestellt:")
    for line in drift:
        print(f"  - {line}")

    if args.check:
        print("❌ --check: manifest.json passt nicht zu den Dateien "
              "(python3 scripts/pin-server-scripts.py ausführen).")
        return 1

    with open(args.manifest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"✍️  {os.path.relpath(args.manifest, ROOT)} aktualisiert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
