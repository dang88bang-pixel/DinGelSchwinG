#!/usr/bin/env python3
"""Universeller Test-Harness — prüft ein Repo unabhängig von Stack (Schritt 5).

Eigenständig: nur Python-Standardbibliothek (PyYAML wird *optional* für den
JSON/YAML-Export genutzt und ist keine Voraussetzung).

Beispiele:
    python3 tests/universe_harness.py                       # Standardlauf
    python3 tests/universe_harness.py --json reports/harness.json
    UNIVERSE_HEALTH_PORTS=5000,8791 python3 tests/universe_harness.py --require-health
    python3 tests/universe_harness.py --skip-build          # nur Health-Probes

Exit-Code: 0 = kein Fehler, 1 = mindestens ein ❌, 2 = Nutzungsfehler/kein Stack.
"⏭ SKIP" ist bewusst *kein* Pass: fehlende Toolchains werden als Handlungsauftrag
ausgewiesen, nicht als grüner Haken.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

try:  # optional — nur für YAML-Export
    import yaml  # type: ignore

    HAVE_YAML = True
except Exception:  # pragma: no cover - PyYAML ist keine Voraussetzung
    yaml = None  # type: ignore
    HAVE_YAML = False

DEFAULT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PORTS = tuple(range(8080, 8086))  # Spezifikation: /health auf 8080–8085
IGNORE_DIRS = {
    ".git", "node_modules", "dist", "build", "out", "target", ".venv", "venv",
    "__pycache__", ".gradle", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "coverage", "reports", "backups",
}

OK, FAIL, SKIP, WARN = "✅", "❌", "⏭", "⚠️"


# ── Ausführung ───────────────────────────────────────────────────────────────
def run(cmd: str, cwd: Path, timeout: int = 900) -> subprocess.CompletedProcess:
    """Führt ein Kommando aus; Timeouts werden zu Rückgabecode 124."""
    try:
        return subprocess.run(
            cmd, shell=True, capture_output=True, text=True, cwd=str(cwd), timeout=timeout
        )
    except subprocess.TimeoutExpired as exc:  # pragma: no cover - Umgebungssache
        return subprocess.CompletedProcess(
            cmd, 124,
            stdout=(exc.stdout or "") if isinstance(exc.stdout, str) else "",
            stderr=f"timeout nach {timeout}s",
        )


def has_cmd(name: str) -> bool:
    return shutil.which(name) is not None


def tail(text: str, lines: int = 12) -> str:
    text = (text or "").strip()
    if not text:
        return ""
    return "\n".join(text.splitlines()[-lines:])


# ── Schritt 0: Stack-Erkennung ───────────────────────────────────────────────
def detect_stacks(root: Path) -> list[str]:
    """Erkennt *alle* Stacks (polyglotte Repos sind der Normalfall)."""
    stacks: list[str] = []
    files: set[str] = set()
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if any(part in IGNORE_DIRS or part == ".git" for part in rel.split("/")):
            continue
        files.add(rel)

    def any_file(*names: str) -> bool:
        return any(n in files for n in names)

    if any_file("package.json"):
        stacks.append("node")
    if any_file("Cargo.toml"):
        stacks.append("rust")
    if any(n.endswith(("build.gradle", "build.gradle.kts")) and "node_modules" not in n
           for n in files):
        stacks.append("android")
    if any_file("go.mod"):
        stacks.append("go")
    if any_file("pyproject.toml", "setup.py", "requirements.txt") or any(
        n.endswith(".py") for n in files
    ):
        stacks.append("python")
    return stacks


def detect_stack(root: Path) -> str:
    """Primärer Stack (Kompatibilität zur Spezifikation)."""
    stacks = detect_stacks(root)
    return stacks[0] if stacks else "unknown"


def describe_stack(root: Path) -> list[str]:
    """Zielplattformen/Frameworks grob ableiten — für den Berichtskopf."""
    hints: list[str] = []
    if (root / "capacitor.config.json").exists() or (root / "capacitor.config.ts").exists():
        hints.append("Capacitor (Android/iOS/Web)")
    if (root / "android").is_dir() or (root / "android-app").is_dir():
        hints.append("Android (Gradle)")
    if (root / "ios").is_dir() or (root / "Podfile").exists():
        hints.append("iOS")
    if (root / "src-tauri").is_dir():
        hints.append("Tauri (Desktop)")
    package_json = root / "package.json"
    if (root / "electron").is_dir() or (
        package_json.exists()
        and "electron" in package_json.read_text(encoding="utf-8", errors="ignore")
    ):
        hints.append("Electron (Desktop)")
    if (root / "Dockerfile").exists():
        hints.append("Container (Docker)")
    if (root / "public" / "manifest.webmanifest").exists() or (root / "index.html").exists():
        hints.append("Web/PWA")
    return hints


# ── Schritt 5: Build/Test je Stack ───────────────────────────────────────────
def _node_check(root: Path, timeout: int, strict: bool = False) -> tuple[str, str, str]:
    if not (root / "node_modules").is_dir() and "test" in json.loads(
        (root / "package.json").read_text(encoding="utf-8")
    ).get("scripts", {}):
        return "Build/Test (node)", SKIP, "node_modules fehlt — erst `npm ci` ausführen"
    proc = run("npm test --if-present", root, timeout)
    detail = "npm test --if-present" if proc.returncode == 0 else tail(proc.stderr or proc.stdout)
    return "Build/Test (node)", (OK if proc.returncode == 0 else FAIL), detail


def _rust_check(root: Path, timeout: int, strict: bool = False) -> tuple[str, str, str]:
    if not has_cmd("cargo"):
        return "Build/Test (rust)", SKIP, "cargo fehlt — https://rustup.rs installieren"
    proc = run("cargo test --no-run", root, timeout)
    detail = "cargo test --no-run" if proc.returncode == 0 else tail(proc.stderr or proc.stdout)
    return "Build/Test (rust)", (OK if proc.returncode == 0 else FAIL), detail


def _android_check(root: Path, timeout: int, strict: bool = False) -> tuple[str, str, str]:
    """Gradle-Unit-Tests. Scheitert der Lauf an der Umgebung (SDK/Java/Gradle-
    Download), ist das per Default eine ⚠️-Warnung — den harten Android-Nachweis
    führt der APK-Workflow (`.github/workflows/build-apk.yml`). Mit --strict wird
    daraus ein ❌."""
    gradlew = next(
        (p for p in (root / "android" / "gradlew", root / "gradlew") if p.exists()), None
    )
    if gradlew is None:
        return "Build/Test (android)", SKIP, "kein gradlew gefunden"
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk or not Path(sdk).is_dir():
        return ("Build/Test (android)", SKIP,
                "Android SDK fehlt (ANDROID_HOME/ANDROID_SDK_ROOT) — `./gradlew testDebugUnitTest`")
    if not has_cmd("java"):
        return ("Build/Test (android)", SKIP,
                "kein `java` im PATH (JDK 21 nötig) — `./gradlew testDebugUnitTest`")
    proc = run("./gradlew testDebugUnitTest --dry-run --no-daemon", gradlew.parent, timeout)
    if proc.returncode == 0:
        return "Build/Test (android)", OK, "./gradlew testDebugUnitTest --dry-run"
    return ("Build/Test (android)", FAIL if strict else WARN,
            "Gradle-Lauf fehlgeschlagen (Umgebung?) — " + tail(proc.stderr or proc.stdout, 3))


_SYNTAX_SNIPPET = '''\
"""Syntaxprüfung ohne Bytecode zu schreiben (kein __pycache__ im Arbeitsbaum)."""
import ast
import pathlib
import sys

SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv", "build", "dist",
        "out", "target", ".gradle", "reports", "backups"}
bad = 0
count = 0
for path in sorted(pathlib.Path(".").rglob("*.py")):
    if SKIP & set(path.parts):
        continue
    count += 1
    try:
        ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    except SyntaxError as exc:
        print(f"{path}:{exc.lineno}: {exc.msg}")
        bad += 1
print(f"{count} Dateien geprüft, {bad} Syntaxfehler")
sys.exit(1 if bad else 0)
'''


def _python_check(root: Path, timeout: int, strict: bool = False) -> tuple[str, str, str]:
    if run("python3 -c 'import pytest'", root, 60).returncode == 0:
        # --continue-on-collection-errors: erst sammeln, dann bewerten.
        proc = run(
            "python3 -m pytest --collect-only -q --continue-on-collection-errors", root, timeout
        )
        blob = f"{proc.stdout}\n{proc.stderr}"
        collected = re.search(r"(\d+) tests? collected", blob)
        label = "python3 -m pytest --collect-only"
        if collected:
            label += f" ({collected.group(1)} Tests eingesammelt)"
        if proc.returncode != 0:
            # Fehlende Fremdabhängigkeiten (z. B. fastapi) sind Umgebungs-, keine Codefehler.
            missing = sorted({m for m in re.findall(r"No module named '([A-Za-z0-9_.]+)'", blob)})
            if missing:
                status = FAIL if strict else WARN
                dep = ", ".join(sorted({m.split(".")[0] for m in missing}))
                return (
                    "Build/Test (python)",
                    status,
                    f"{label} — fehlende Abhängigkeit(en): {dep} "
                    f"(Installationsbefehl in <projekt>/requirements.txt bzw. pyproject.toml)",
                )
            return "Build/Test (python)", FAIL, tail(proc.stdout or proc.stderr)
    else:
        # Kein pytest: Syntaxprüfung über ast.parse — schreibt bewusst *keine*
        # Bytecode-Caches (compileall würde __pycache__ anlegen).
        handle = tempfile.NamedTemporaryFile(
            "w", suffix="_universe_syntax.py", delete=False, encoding="utf-8"
        )
        handle.write(_SYNTAX_SNIPPET)
        handle.close()
        try:
            proc = run(f"python3 {handle.name}", root, timeout)
        finally:
            os.unlink(handle.name)
        label = f"ast.parse-Syntaxprüfung (pytest nicht installiert): {tail(proc.stdout, 1)}"
    detail = label if proc.returncode == 0 else tail(proc.stderr or proc.stdout)
    return "Build/Test (python)", (OK if proc.returncode == 0 else FAIL), detail


def _go_check(root: Path, timeout: int, strict: bool = False) -> tuple[str, str, str]:
    if not has_cmd("go"):
        return "Build/Test (go)", SKIP, "go fehlt — https://go.dev/dl/ installieren"
    proc = run("go test ./...", root, timeout)
    detail = "go test ./..." if proc.returncode == 0 else tail(proc.stderr or proc.stdout)
    return "Build/Test (go)", (OK if proc.returncode == 0 else FAIL), detail


def test_build(
    stack: str, root: Path = DEFAULT_ROOT, timeout: int = 900, strict: bool = False
) -> tuple[str, str, str]:
    """Führt den Stack-Check aus und liefert (Name, Status, Detail).

    ``strict=True`` wertet umgebungsbedingte Warnungen (⚠️) als ❌.
    """
    runners = {
        "node": _node_check,
        "rust": _rust_check,
        "android": _android_check,
        "python": _python_check,
        "go": _go_check,
    }
    runner = runners.get(stack)
    if runner is None:
        return f"Build/Test ({stack})", SKIP, "kein Testkommando für diesen Stack bekannt"
    return runner(root, timeout, strict)


def test_build_artifact(
    stack: str, root: Path = DEFAULT_ROOT, timeout: int = 1800
) -> tuple[str, str, str]:
    """Erzeugt das Build-Artefakt (nur wo sinnvoll) — Schritt 5, letzter Punkt."""
    cmds = {"node": "npm run build", "rust": "cargo build --release", "go": "go build ./..."}
    cmd = cmds.get(stack)
    if cmd is None:
        return f"Build-Artefakt ({stack})", SKIP, "kein Build-Schritt definiert"
    proc = run(cmd, root, timeout)
    detail = cmd if proc.returncode == 0 else tail(proc.stderr or proc.stdout)
    return f"Build-Artefakt ({stack})", (OK if proc.returncode == 0 else FAIL), detail


# ── Schritt 5: Health-Endpunkte ──────────────────────────────────────────────
def probe_health(port: int, timeout: float = 2.0) -> str:
    """HTTP-Status von /health, 'tcp-only' (Port offen, kein HTTP) oder 'down'."""
    url = f"http://127.0.0.1:{port}/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return str(resp.status)
    except urllib.error.HTTPError as exc:
        return str(exc.code)
    except Exception:
        pass
    # Zweiter Versuch: roher TCP-Connect — unterscheidet „kein Dienst" von
    # „Dienst läuft, spricht aber kein HTTP/health" (z. B. Protobuf/FlatBuffers).
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return "tcp-only"
    except OSError:
        return "down"


def test_health_endpoints(
    ports: tuple[int, ...] = DEFAULT_PORTS, require: bool = False
) -> list[tuple[str, str, str]]:
    """Prüft /health je Port. Ohne --require-health sind Down-Ports nur Hinweise."""
    results: list[tuple[str, str, str]] = []
    for port in ports:
        code = probe_health(port)
        if code == "200":
            results.append((f"health:{port}", OK, "HTTP 200 auf /health"))
        elif code == "tcp-only":
            # Port ist belegt, spricht aber kein HTTP/health (z. B. reiner TCP-Dienst).
            results.append((f"health:{port}", WARN, "Port offen, aber kein HTTP /health"))
        elif code == "down":
            status = FAIL if require else SKIP
            results.append((f"health:{port}", status, "kein Listener auf 127.0.0.1"))
        else:
            results.append((f"health:{port}", WARN, f"HTTP {code} (erreichbar, aber kein 200)"))
    return results


# ── CLI ──────────────────────────────────────────────────────────────────────
def parse_ports(raw: str | None) -> tuple[int, ...]:
    if not raw:
        return DEFAULT_PORTS
    ports: list[int] = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            lo, hi = chunk.split("-", 1)
            ports.extend(range(int(lo), int(hi) + 1))
        else:
            ports.append(int(chunk))
    return tuple(sorted(set(ports)))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Universeller Test-Harness (Stack-Erkennung, Build/Test, Health-Probes)"
    )
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Repo-Wurzel")
    parser.add_argument("--stacks", default="", help="Stacks erzwingen, z. B. 'node,python'")
    parser.add_argument("--skip-build", action="store_true", help="Build/Test-Checks überspringen")
    parser.add_argument("--skip-health", action="store_true", help="Health-Probes überspringen")
    parser.add_argument("--require-health", action="store_true",
                        help="Offline-Ports als ❌ werten (sonst ⏭)")
    parser.add_argument("--ports", default=os.environ.get("UNIVERSE_HEALTH_PORTS", ""),
                        help="Ports für /health, z. B. '5000,8791' oder '8080-8085'")
    parser.add_argument("--strict", action="store_true",
                        help="umgebungsbedingte Warnungen (z. B. Gradle-Abbruch) als ❌ werten")
    parser.add_argument("--with-build", action="store_true",
                        help="zusätzlich das Build-Artefakt erzeugen (npm run build, cargo build …)")
    parser.add_argument("--timeout", type=int, default=900, help="Timeout je Kommando (s)")
    parser.add_argument("--json", dest="json_path", default="", help="Ergebnis als JSON schreiben")
    parser.add_argument("--yaml", dest="yaml_path", default="", help="Ergebnis als YAML schreiben")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"{FAIL} Repo-Wurzel nicht gefunden: {root}", file=sys.stderr)
        return 2

    stacks = [s.strip() for s in args.stacks.split(",") if s.strip()] or detect_stacks(root)
    if not stacks:
        print(f"{FAIL} Kein bekannter Stack erkannt (package.json/Cargo.toml/build.gradle/go.mod/pyproject.toml)")
        stacks = ["unknown"]

    print(f"Repo    : {root}")
    print(f"Stacks  : {', '.join(stacks)}")
    extra = describe_stack(root)
    if extra:
        print(f"Plattform: {', '.join(extra)}")
    print(f"Zeit    : {time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print("-" * 72)

    checks: list[dict] = []
    if not args.skip_build:
        for stack in stacks:
            name, status, detail = test_build(stack, root, args.timeout, args.strict)
            checks.append({"name": name, "status": status, "detail": detail})
            print(f"{status} {name}" + (f" — {detail}" if detail and status != OK else ""))
    if args.with_build:
        for stack in stacks:
            name, status, detail = test_build_artifact(stack, root, args.timeout)
            checks.append({"name": name, "status": status, "detail": detail})
            print(f"{status} {name}" + (f" — {detail}" if detail and status != OK else ""))
    if not args.skip_health:
        ports = parse_ports(args.ports)
        for name, status, detail in test_health_endpoints(ports, args.require_health):
            checks.append({"name": name, "status": status, "detail": detail})
            print(f"{status} {name}" + (f" — {detail}" if detail and status != OK else ""))

    failed = [c for c in checks if c["status"] == FAIL]
    skipped = [c for c in checks if c["status"] == SKIP]
    warned = [c for c in checks if c["status"] == WARN]
    if not checks:
        verdict = "PARTIAL-NO-CHECKS"
    elif failed:
        verdict = "BLOCKED"
    elif skipped or warned:
        verdict = "PARTIAL"
    else:
        verdict = "READY"

    print("-" * 72)
    print(f"{len(checks)} Checks · ✅ {len(checks) - len(failed) - len(skipped) - len(warned)} "
          f"· ⏭ {len(skipped)} · ⚠️ {len(warned)} · ❌ {len(failed)}")
    print(f"Fazit: {verdict}")

    if args.json_path or args.yaml_path:
        payload = {
            "repo": str(root),
            "stacks": stacks,
            "platforms": extra,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "checks": checks,
            "verdict": verdict,
        }
        for path, is_yaml in ((args.json_path, False), (args.yaml_path, True)):
            if not path:
                continue
            target = Path(path)
            target.parent.mkdir(parents=True, exist_ok=True)
            if is_yaml and HAVE_YAML:
                target.write_text(yaml.safe_dump(payload, allow_unicode=True), encoding="utf-8")
            else:
                if is_yaml:
                    print("ℹ️  PyYAML nicht installiert — schreibe JSON (identischer Inhalt).")
                target.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"📄 Ergebnis: {target}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
