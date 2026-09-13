"""Vertrags-Check: server/app.py ⇄ docs/openapi.yaml ⇄ Frontend-Aufrufe.

Verhindert die drei Drift-Arten, die im Audit 2026-09-13 gefunden wurden:
  1. dokumentierte, aber nicht implementierte Endpunkte (z. B. /api/devices-status),
  2. implementierte, aber undokumentierte Endpunkte (z. B. /api/rosetta),
  3. Frontend-Aufrufe ohne Server-Route (z. B. /api/scan, /api/diagnostics/iperf).

Nur Standardbibliothek — läuft in `make test-py` ohne Zusatzpakete.
"""
from __future__ import annotations

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APP_PY = os.path.join(ROOT, "server", "app.py")
SPEC = os.path.join(ROOT, "docs", "openapi.yaml")
SRC = os.path.join(ROOT, "src")

#: WebSocket-Kanäle sind nicht Teil von OpenAPI 3, sondern in docs/api-websockets.md
#: beschrieben — sie dürfen daher in der Spec fehlen.
WS_ALLOWLIST = {"/ws/status", "/api/ws/status", "/api/ws/terminal", "/api/ws/discovery"}


def implemented_paths() -> tuple[set[str], set[str]]:
    """(exakte Pfade, startswith-Präfixe) aus server/app.py."""
    with open(APP_PY, encoding="utf-8") as fh:
        text = fh.read()
    exact: set[str] = set()
    prefixes: set[str] = set()
    for m in re.finditer(r'path == "(/[^"]+)"', text):
        exact.add(m.group(1))
    for m in re.finditer(r'path in \(([^)]*)\)', text):
        exact |= set(re.findall(r'"(/[^"]+)"', m.group(1)))
    for m in re.finditer(r'path\.startswith\((?:"(/[^"]+)"|\(([^)]*)\))', text):
        if m.group(1):
            prefixes.add(m.group(1))
        else:
            prefixes |= set(re.findall(r'"(/[^"]+)"', m.group(2)))
    return exact, prefixes


def spec_paths() -> set[str]:
    with open(SPEC, encoding="utf-8") as fh:
        return set(re.findall(r"^  (/[^:]+):", fh.read(), re.M))


def frontend_paths() -> set[str]:
    """`/api/...`-Literale aus String-/Template-Literalen (keine Import-Pfade,
    keine JSX-Anzeigetexte): vorausgehendes Zeichen muss ein Quote sein."""
    out: set[str] = set()
    pattern = re.compile(r"""['"`](/api/[A-Za-z0-9_./-]+)""")
    for base, _dirs, files in os.walk(SRC):
        for name in files:
            if not name.endswith((".ts", ".tsx")):
                continue
            with open(os.path.join(base, name), encoding="utf-8") as fh:
                text = fh.read()
            out |= set(pattern.findall(text))
    return {p.rstrip("/") or "/" for p in out}


def _static(template: str) -> str:
    """OpenAPI-Template auf den statischen Prefix kürzen: /a/{id}/b → /a/."""
    parts = template.split("/")
    keep = []
    for part in parts:
        if part.startswith("{"):
            break
        keep.append(part)
    return "/".join(keep).rstrip("/") + "/" if len(keep) < len(parts) else "/".join(keep)


class TestApiContract(unittest.TestCase):
    def setUp(self) -> None:
        self.exact, self.prefixes = implemented_paths()
        self.spec = spec_paths()

    def _implemented(self, path: str) -> bool:
        if path in self.exact:
            return True
        return any(path.startswith(pref) for pref in self.prefixes)

    def test_server_routes_gefunden(self) -> None:
        """Sanity: die Extraktion liefert die bekannten Routen."""
        for expected in ("/api/health", "/api/login", "/api/devices", "/api/scan",
                         "/api/diagnostics/iperf", "/api/scripts/run", "/metrics"):
            self.assertIn(expected, self.exact, f"Route {expected} nicht in server/app.py")

    def test_spec_ist_implementiert(self) -> None:
        """Jeder dokumentierte Pfad existiert im Server (keine Phantom-API)."""
        missing = []
        for template in sorted(self.spec):
            static = _static(template)
            if template in self.exact:
                continue
            if any(static.startswith(p) or p.startswith(static) for p in self.prefixes):
                continue
            if self._implemented(template):
                continue
            missing.append(template)
        self.assertEqual(missing, [], f"dokumentiert, aber nicht implementiert: {missing}")

    def test_frontend_ist_implementiert(self) -> None:
        """Jeder /api/-Aufruf des Frontends hat eine Server-Route."""
        missing = sorted(p for p in frontend_paths()
                         if p not in WS_ALLOWLIST and not self._implemented(p))
        self.assertEqual(missing, [], f"Frontend ruft nicht implementierte Pfade auf: {missing}")

    def test_implementiert_ist_dokumentiert(self) -> None:
        """Jede Server-Route steht in openapi.yaml (oder ist WS-dokumentiert)."""
        documented = set(self.spec)
        for template in self.spec:
            documented.add(_static(template))
        missing = []
        for path in sorted(self.exact | self.prefixes):
            if path in WS_ALLOWLIST:
                continue
            if path in documented:
                continue
            if any(path.startswith(d) or d.startswith(path) for d in documented):
                continue
            missing.append(path)
        self.assertEqual(missing, [], f"implementiert, aber nicht dokumentiert: {missing}")

    def test_operations_center_aktionen(self) -> None:
        """Die drei Backend-Aktionen des Operations-Centers sind erreichbar."""
        for path in ("/api/health", "/api/scan", "/api/scripts/run", "/api/diagnostics/iperf"):
            self.assertTrue(self._implemented(path), f"{path} fehlt serverseitig")
            self.assertIn(path, self.spec, f"{path} fehlt in docs/openapi.yaml")


if __name__ == "__main__":
    unittest.main(verbosity=2)
