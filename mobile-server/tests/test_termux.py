"""Tests für die Termux-Bridge (Termux · Termux:API · Termux:Widget).

Läuft ohne Framework (`python3 mobile-server/tests/test_termux.py`) UND mit pytest.

// REAL-IMPLEMENTATION 2026-09-13: Es wird nicht die Bridge „gemockt“, sondern
der echte Ausführungspfad getestet — mit echten ausführbaren Dateien in einem
temporären Termux-`$PREFIX/bin`. Damit prüfen die Tests genau das, was auf dem
Gerät passiert: Prozessstart, Argument-Whitelist, Timeouts, JSON-Parsing,
Widget-Lauf und Pfadschutz.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import termux_bridge as T  # noqa: E402

# ── Testumgebung: echtes Termux-PREFIX mit ausführbaren Stubs ────────────────
_FAKE_BINARIES = {
    "termux-battery-status": 'echo \'{"health":"GOOD","percentage":87,"temperature":31.5,"plugged":"UNPLUGGED"}\'',
    "termux-wifi-connectioninfo": 'echo \'{"ssid":"Werkstatt","rssi":-52,"link_speed_mbps":433}\'',
    "termux-sensor": 'case "$1" in -l) echo \'["accel","gyro"]\';; -s) echo \'{"accel":{"values":[0.1,0.2,9.8]}}\';; *) echo \'["accel","gyro"]\';; esac',
    "termux-telephony-deviceinfo": 'echo \'{"network_operator_name":"Telekom","sim_state":"READY"}\'',
    "termux-notification": 'echo "notified: $*"',
    "termux-toast": 'echo "toast: $*"',
    "termux-vibrate": 'echo "vibrate: $*"',
    "termux-clipboard-get": 'echo "zwischenablage-inhalt"',
    "termux-clipboard-set": 'cat >/dev/null; echo "ok"',
    "termux-torch": 'echo "torch: $*"',
    "termux-info": 'echo "Termux 0.118.1"',
    "termux-open-url": 'echo "url: $*"',
    "termux-sms-list": 'echo \'[{"number":"+49123","body":"Tor Nord offen"}]\'',
    "termux-location": 'echo \'{"latitude":52.52,"longitude":13.405}\'',
    # Echte Verzögerung, um das Timeout zu prüfen (kein Fake-Timer nötig).
    "termux-slow": 'sleep 5; echo "zu spät"',
}

_env_backup: dict[str, str | None] = {}


def _make_fake_termux(root: Path) -> Path:
    """Baut ein Termux-PREFIX mit echten ausführbaren Stubs in `bin/`."""
    prefix = root / "com.termux" / "files" / "usr"
    bin_dir = prefix / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)
    for name, body in _FAKE_BINARIES.items():
        path = bin_dir / name
        path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
        path.chmod(0o755)
    return prefix


def _setup() -> tuple[Path, Path, Path]:
    """Termux-Umgebung simulieren: PREFIX, HOME, ~/.shortcuts mit Widgets."""
    root = Path(tempfile.mkdtemp(prefix="dgs-termux-test-"))
    prefix = _make_fake_termux(root)
    home = root / "home"
    shortcuts = home / ".shortcuts"
    shortcuts.mkdir(parents=True, exist_ok=True)
    boot = home / ".termux" / "boot"
    boot.mkdir(parents=True, exist_ok=True)

    widget = shortcuts / "10-gateway-status.sh"
    widget.write_text("#!/bin/sh\necho 'Gateway: läuft (mock=False)'\necho \"args: $*\"\n", encoding="utf-8")
    widget.chmod(0o755)

    broken = shortcuts / "20-kaputt.sh"
    broken.write_text("#!/bin/sh\necho 'kaputt' >&2\nexit 3\n", encoding="utf-8")
    broken.chmod(0o755)

    not_exec = shortcuts / "30-nicht-ausfuehrbar.sh"
    not_exec.write_text("#!/bin/sh\necho nein\n", encoding="utf-8")
    not_exec.chmod(0o644)

    # Kein Skript, nur Daten — darf nicht als Widget auftauchen.
    (shortcuts / "notizen.txt").write_text("kein Skript", encoding="utf-8")

    for key, value in (
        ("DGS_TERMUX_PREFIX", str(prefix)),
        ("HOME", str(home)),
        ("DGS_TERMUX_WIDGET_DIR", str(shortcuts)),
    ):
        _env_backup[key] = os.environ.get(key)
        os.environ[key] = value
    return root, prefix, home


def _teardown(root: Path) -> None:
    for key, value in _env_backup.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    shutil.rmtree(root, ignore_errors=True)


# ── Erkennung ────────────────────────────────────────────────────────────────
def test_detects_termux_environment():
    root, prefix, _home = _setup()
    try:
        assert T.is_termux() is True
        assert T.termux_prefix() == prefix
        caps = T.capabilities()
        assert caps["termux"] is True
        assert caps["api"]["count"] >= 10, caps["api"]
        assert "battery" not in caps["api"]["missing"]
        assert caps["widgets"]["ok"] is True
        assert caps["widgets"]["count"] == 3, caps["widgets"]["scripts"]
        assert caps["boot"]["ok"] is True
        assert caps["hint"].startswith("Termux, Termux:API"), caps["hint"]
    finally:
        _teardown(root)


def test_without_termux_reports_honestly():
    """Ohne PREFIX/PATH gibt es keine erfundene Verfügbarkeit."""
    saved = os.environ.pop("DGS_TERMUX_PREFIX", None)
    saved_prefix = os.environ.pop("PREFIX", None)
    saved_path = os.environ.get("PATH", "")
    os.environ["PATH"] = "/nonexistent-bin"
    try:
        assert T.is_termux() is False
        result = T.run("battery")
        assert result["ok"] is False
        assert "nicht gefunden" in result["reason"]
        caps = T.capabilities()
        assert caps["api"]["count"] == 0
        assert caps["widgets"]["ok"] is False
    finally:
        if saved is not None:
            os.environ["DGS_TERMUX_PREFIX"] = saved
        if saved_prefix is not None:
            os.environ["PREFIX"] = saved_prefix
        os.environ["PATH"] = saved_path


# ── Kommando-Ausführung ──────────────────────────────────────────────────────
def test_run_executes_command_and_parses_json():
    root, _prefix, _home = _setup()
    try:
        result = T.run("battery")
        assert result["ok"] is True, result
        assert result["parsed"]["percentage"] == 87
        assert result["duration_ms"] >= 0

        wifi = T.run("wifi")
        assert wifi["parsed"]["ssid"] == "Werkstatt"
        assert wifi["parsed"]["rssi"] == -52
    finally:
        _teardown(root)


def test_run_rejects_unknown_command():
    root, _prefix, _home = _setup()
    try:
        result = T.run("rm_rf", {})
        assert result["ok"] is False
        assert "unbekanntes termux-kommando" in result["reason"]
        assert "battery" in result["allowed"]
        assert "shell" not in result["allowed"]
    finally:
        _teardown(root)


def test_argument_whitelist_and_limits():
    root, _prefix, _home = _setup()
    try:
        # Erlaubte Flags landen als argv im echten Prozess
        res = T.run("notify", {"title": "Tor", "content": "Nord offen"})
        assert res["ok"] is True
        assert "--title" in res["argv"] and "Tor" in res["argv"]
        assert "notified" in res["stdout"]

        # Zu langer Text wird abgelehnt, das Binary nie gestartet
        long = T.run("notify", {"content": "x" * 600})
        assert long["ok"] is False and "zu lang" in long["reason"]

        # Zahlenbereich
        assert T.run("vibrate", {"duration_ms": 400})["argv"][-1] == "400"
        assert T.run("vibrate", {"duration_ms": 99999})["ok"] is False

        # Auswahl
        assert T.run("torch", {"state": "on"})["ok"] is True
        assert T.run("torch", {"state": "vielleicht"})["ok"] is False

        # URL-Schema
        assert T.run("open_url", {"url": "https://f-droid.org"})["ok"] is True
        assert T.run("open_url", {"url": "file:///etc/passwd"})["ok"] is False

        # sensor_read braucht einen Sensor
        assert T.run("sensor_read", {})["ok"] is False
        assert T.run("sensor_read", {"sensor": "accel"})["ok"] is True

        # Kein Durchreichen unbekannter Parameter
        argv, _reason = T.build_argv("toast", {"text": "hallo", "--exec": "rm -rf /"})
        assert argv == ["termux-toast", "hallo"], argv
    finally:
        _teardown(root)


def test_timeout_is_enforced():
    root, prefix, _home = _setup()
    try:
        # Zusätzliches, langsames Binary in dasselbe PREFIX legen
        slow = prefix / "bin" / "termux-notification"
        slow.write_text("#!/bin/sh\nsleep 5\necho spät\n", encoding="utf-8")
        slow.chmod(0o755)
        started = time.perf_counter()
        result = T.run("notify", {"title": "langsam"}, timeout=0.4)
        elapsed = time.perf_counter() - started
        assert result["ok"] is False
        assert "timeout" in result["reason"]
        assert elapsed < 3, f"Timeout hat nicht gegriffen ({elapsed:.1f}s)"
    finally:
        _teardown(root)


def test_cli_status_and_run(tmp_path=None):
    """Selbsttest über die CLI (so rufen Widgets und Diagnose die Bridge auf)."""
    root, _prefix, _home = _setup()
    try:
        import subprocess

        env = dict(os.environ)
        script = HERE.parent / "termux_bridge.py"
        out = subprocess.run(
            [sys.executable, str(script), "status"],
            capture_output=True, text=True, env=env, timeout=30, check=False,
        )
        assert out.returncode == 0, out.stderr
        payload = json.loads(out.stdout)
        assert payload["termux"] is True
        assert payload["probes"]["battery"]["parsed"]["percentage"] == 87

        run_out = subprocess.run(
            [sys.executable, str(script), "run", "toast", '{"text":"hallo"}'],
            capture_output=True, text=True, env=env, timeout=30, check=False,
        )
        assert run_out.returncode == 0, run_out.stderr
        assert json.loads(run_out.stdout)["ok"] is True
    finally:
        _teardown(root)


# ── Widgets (Termux:Widget) ──────────────────────────────────────────────────
def test_widget_listing_filters_non_scripts():
    root, _prefix, _home = _setup()
    try:
        names = [w["name"] for w in T.list_widgets()]
        assert "10-gateway-status.sh" in names
        assert "20-kaputt.sh" in names
        assert "notizen.txt" not in names
        assert all(w["name"].endswith((".sh", ".bash")) for w in T.list_widgets())
        status = T.status(probe=False)
        assert status["widgets"]["count"] == 3
    finally:
        _teardown(root)


def test_widget_run_real_process():
    root, _prefix, _home = _setup()
    try:
        result = T.widget_run("10-gateway-status.sh", args=["--short"])
        assert result["ok"] is True, result
        assert "Gateway: läuft" in result["stdout"]
        assert "args: --short" in result["stdout"]

        failing = T.widget_run("20-kaputt.sh")
        assert failing["ok"] is False
        assert failing["code"] == 3
        assert "kaputt" in failing["stderr"]
    finally:
        _teardown(root)


def test_widget_security_guards():
    root, _prefix, home = _setup()
    try:
        # Pfad-Ausbruch, absoluter Pfad, Shell-Metazeichen, andere Endungen
        for bad in ("../etc/passwd.sh", "/etc/passwd.sh", "a;rm -rf /.sh", "script.sh; rm -rf /", "böse.sh"):
            result = T.widget_run(bad)
            assert result["ok"] is False, bad
            assert "ungültiger Skriptname" in result["reason"] or "verlässt" in result["reason"], result

        # Nicht ausführbar → klarer Hinweis statt Fehlstart
        result = T.widget_run("30-nicht-ausfuehrbar.sh")
        assert result["ok"] is False
        assert "nicht ausführbar" in result["reason"]

        # Fehlendes Skript
        assert T.widget_run("40-gibtsnicht.sh")["ok"] is False

        # Argument-Whitelist
        ok_args = T.widget_run("10-gateway-status.sh", args=["--json", "status=1", "pfad/x.yaml"])
        assert ok_args["ok"] is True, ok_args
        bad_args = T.widget_run("10-gateway-status.sh", args=["$(whoami)"])
        assert bad_args["ok"] is False
        assert "Argument abgelehnt" in bad_args["reason"]

        # Symlink aus ~/.shortcuts heraus wird erkannt
        outside = home / "geheim.sh"
        outside.write_text("#!/bin/sh\necho geheim\n", encoding="utf-8")
        outside.chmod(0o755)
        link = T.widget_dir() / "99-link.sh"
        link.symlink_to(outside)
        assert T.widget_run("99-link.sh")["ok"] is False
    finally:
        _teardown(root)


# ── Aggregat /status ─────────────────────────────────────────────────────────
def test_status_probe_collects_live_values():
    root, _prefix, _home = _setup()
    try:
        payload = T.status(probe=True)
        assert payload["ok"] is True
        assert payload["api_present"] >= 10
        assert payload["probes"]["battery"]["parsed"]["percentage"] == 87
        assert payload["probes"]["wifi"]["parsed"]["ssid"] == "Werkstatt"
        assert payload["probes"]["telephony"]["parsed"]["sim_state"] == "READY"
        # JSON-Roundtrip: /status muss serialisierbar bleiben
        json.dumps(payload)

        quiet = T.status(probe=False)
        assert quiet["probes"] == {}
    finally:
        _teardown(root)


def test_build_argv_is_pure():
    """build_argv darf nichts ausführen (nur prüfen) — Grundlage der Whitelist."""
    argv, reason = T.build_argv("battery", {})
    assert argv == ["termux-battery-status"]
    assert reason == ""
    argv, reason = T.build_argv("gibt_es_nicht", {})
    assert argv is None and reason



# ── Gateway-Anbindung (POST /command → handle_command) ──────────────────────
def _make_gateway_state(tmp_hint: str):
    """Isolierter GatewayState wie in test_gateway.py (eigenes tmp-Verzeichnis)."""
    import asyncio

    from gateway import GatewayState
    from gw_config import GatewayConfig

    root = Path(tempfile.mkdtemp(prefix=f"dgs-termux-gw-{tmp_hint}-"))
    cfg = GatewayConfig.from_env(
        whitelist_file=root / "whitelist.json",
        audit_file=root / "audit.jsonl",
        sessions_file=root / "sessions.json",
        mock=True,
        require_agent_proof="off",
        agent_secret="",
    )
    state = GatewayState(cfg=cfg, auto_respond=False)
    state.whitelist_file = root / "whitelist.json"
    state.audit_file = root / "audit.jsonl"
    return root, state, asyncio


def test_gateway_actions_reach_termux():
    """Die Actions des Gateways müssen echte Termux-Aufrufe auslösen."""
    root, state, asyncio = _make_gateway_state("actions")
    env_root, _prefix, home = _setup()
    try:
        import gateway

        # 1) Status (read-only Bestandsaufnahme)
        result = asyncio.run(gateway.handle_command(state, {"action": "termux_status", "probe": True}))
        assert result["ok"] is True, result
        assert result["termux"] is True
        assert result["api_present"] >= 10
        assert result["probes"]["battery"]["parsed"]["percentage"] == 87

        # 2) Einzel-Kommando mit Parametern
        notified = asyncio.run(gateway.handle_command(state, {
            "action": "termux_run", "command": "notify",
            "params": {"title": "Gateway", "content": "Termux erreichbar"},
        }))
        assert notified["ok"] is True, notified
        assert notified["command"] == "notify"
        assert state.metrics["termux_calls"] == 1

        # 3) Nicht freigegebenes Kommando bleibt gesperrt
        blocked = asyncio.run(gateway.handle_command(state, {
            "action": "termux_run", "command": "shell", "params": {"cmd": "rm -rf /"},
        }))
        assert blocked["ok"] is False
        assert "unbekanntes termux-kommando" in blocked["reason"]
        assert state.metrics["termux_errors"] >= 1

        # 4) Widget-Liste + echter Widget-Lauf
        widgets = asyncio.run(gateway.handle_command(state, {"action": "termux_widgets"}))
        names = [w["name"] for w in widgets["scripts"]]
        assert "10-gateway-status.sh" in names

        ran = asyncio.run(gateway.handle_command(state, {
            "action": "termux_widget_run", "widget": "10-gateway-status.sh", "args": ["--kurz"],
        }))
        assert ran["ok"] is True, ran
        assert "Gateway: läuft" in ran["stdout"]
        assert state.metrics["termux_widget_runs"] == 1

        # 5) Pfad-Ausbruch wird auch über das Gateway abgewiesen
        evil = asyncio.run(gateway.handle_command(state, {
            "action": "termux_widget_run", "widget": "../../etc/passwd.sh",
        }))
        assert evil["ok"] is False

        # 6) Unbekannte termux-Aktion
        unknown = asyncio.run(gateway.handle_command(state, {"action": "termux_reboot"}))
        assert unknown["ok"] is False
        assert "unbekannte termux-aktion" in unknown["reason"]

        # 7) Audit-Spur geschrieben
        audit_text = (state.audit_file).read_text(encoding="utf-8")
        assert "termux_widget" in audit_text
        assert "termux_run" in audit_text

        # 8) /status-Block und Prometheus-Ausgabe
        block = state.termux_block(probe=False)
        assert block["widgets"]["count"] == 3
        metrics = state.metrics_text()
        assert "dingelschwing_gateway_termux_available 1" in metrics
        assert "dingelschwing_gateway_termux_widgets 3" in metrics
        assert "dingelschwing_gateway_termux_calls" in metrics
        snap = state.snapshot()
        assert snap["termux"]["ok"] is True
        json.dumps(snap)
    finally:
        _teardown(env_root)
        shutil.rmtree(root, ignore_errors=True)


def test_gateway_without_termux_is_honest():
    """Ohne Termux meldet das Gateway das ehrlich (kein stiller Fake-Erfolg)."""
    root, state, asyncio = _make_gateway_state("notermux")
    saved_prefix = os.environ.pop("DGS_TERMUX_PREFIX", None)
    saved_path = os.environ.get("PATH", "")
    os.environ["PATH"] = "/nonexistent-bin"
    try:
        import gateway

        result = asyncio.run(gateway.handle_command(state, {"action": "termux_status"}))
        assert result["ok"] is False
        assert result["termux"] is False
        assert "Termux" in result["hint"] or "PREFIX" in result["hint"]

        metrics = state.metrics_text()
        assert "dingelschwing_gateway_termux_available 0" in metrics
    finally:
        os.environ["PATH"] = saved_path
        if saved_prefix is not None:
            os.environ["DGS_TERMUX_PREFIX"] = saved_prefix
        shutil.rmtree(root, ignore_errors=True)

def main() -> int:
    tests = [(name, obj) for name, obj in sorted(globals().items()) if name.startswith("test_") and callable(obj)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ✅ {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  ❌ {name}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} termux-tests bestanden")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
