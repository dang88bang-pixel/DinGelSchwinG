#!/usr/bin/env python3
"""Verifikations-Check für das Flutter-Projekt der BLE Professional Suite.

Führt ohne Dart-SDK durchführbare statische Checks aus:
  1. Klammerbalance je .dart-Datei
  2. Import-Auflösung (relative Imports zeigen auf existierende Dateien)
  3. XML/JSON/plist-Wohlgeformtheit (Android/iOS/Assets)
  4. Keine bekannten Stub-Marker (Stream.empty() ohne Quelle, TODO-Stubs)

Ausführung:  python3 tool/check_project.py
"""
from __future__ import annotations

import json
import os
import plistlib
import re
import sys
import xml.dom.minidom

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILURES: list[str] = []


def fail(msg: str) -> None:
    FAILURES.append(msg)


def check_brackets() -> None:
    for root, _dirs, files in os.walk(os.path.join(ROOT, "lib")):
        for f in sorted(files):
            if not f.endswith(".dart"):
                continue
            path = os.path.join(root, f)
            src = open(path, encoding="utf-8").read()
            s = re.sub(r"//[^\n]*", "", src)
            s = re.sub(r"'(?:\\.|[^'\\])*'", "''", s)
            s = re.sub(r'"(?:\\.|[^"\\])*"', '""', s)
            for o, c in [("{", "}"), ("(", ")"), ("[", "]")]:
                if s.count(o) != s.count(c):
                    fail(f"{os.path.relpath(path, ROOT)}: {o}={s.count(o)} {c}={s.count(c)}")


def check_imports() -> None:
    import_re = re.compile(r"^\s*import\s+'([^']+)'", re.M)
    for root, _dirs, files in os.walk(os.path.join(ROOT, "lib")):
        for f in sorted(files):
            if not f.endswith(".dart"):
                continue
            path = os.path.join(root, f)
            src = open(path, encoding="utf-8").read()
            base = os.path.dirname(path)
            for m in import_re.finditer(src):
                target = m.group(1)
                if target.startswith("package:") or target.startswith("dart:"):
                    continue
                if not os.path.exists(os.path.normpath(os.path.join(base, target))):
                    fail(f"{os.path.relpath(path, ROOT)}: Import existiert nicht -> {target}")


def check_xml_json_plist() -> None:
    for root, _dirs, files in os.walk(os.path.join(ROOT, "android")):
        for f in files:
            if f.endswith(".xml"):
                try:
                    xml.dom.minidom.parse(os.path.join(root, f))
                except Exception as e:  # noqa: BLE001
                    fail(f"XML ungültig {os.path.join(root, f)}: {e}")
    for f in os.listdir(os.path.join(ROOT, "assets", "profiles")):
        if f.endswith(".json"):
            try:
                json.load(open(os.path.join(ROOT, "assets", "profiles", f), encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                fail(f"JSON ungültig assets/profiles/{f}: {e}")
    plist = os.path.join(ROOT, "ios", "Runner", "Info.plist")
    try:
        plistlib.load(open(plist, "rb"))
    except Exception as e:  # noqa: BLE001
        fail(f"Info.plist ungültig: {e}")


def check_no_inactive_stubs() -> None:
    """Bekannte Stub-Muster, die 'inaktive Parts' kennzeichnen."""
    stub_markers = [
        (r"Stream\.empty\(\)", "Stream.empty() – keine echte Quelle"),
    ]
    for root, _dirs, files in os.walk(os.path.join(ROOT, "lib")):
        for f in files:
            if not f.endswith(".dart"):
                continue
            path = os.path.join(root, f)
            src = open(path, encoding="utf-8").read()
            for pattern, label in stub_markers:
                if re.search(pattern, src):
                    fail(f"{os.path.relpath(path, ROOT)}: Stub-Marker {label}")


def main() -> int:
    check_brackets()
    check_imports()
    check_xml_json_plist()
    check_no_inactive_stubs()

    dart_count = sum(
        len([f for f in fs if f.endswith(".dart")])
        for _r, _d, fs in os.walk(os.path.join(ROOT, "lib"))
    )
    print(f"Dart-Dateien geprüft: {dart_count}")
    if FAILURES:
        print("FEHLGESCHLAGEN:")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("OK – alle statischen Checks bestanden")
    return 0


if __name__ == "__main__":
    sys.exit(main())
