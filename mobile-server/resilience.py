"""Fehlerresistenz des mobilen Gateways (nur Stdlib).

// REAL-IMPLEMENTATION 2026-09-11 (Phase 5):
- Watchdog: meldet sich die Async-Schleife > 5 s nicht (Heartbeat), wird der
  Prozess mit Exit-Code 42 beendet, damit ihn systemd/Docker neu startet.
- Log-Rotation: `data/gateway.log` (1 MiB x 4), Konsole bleibt zusätzlich aktiv.
- Bug-Reports: unbehandelte Exceptions landen als `data/bug_report_<ts>.json`
  (Traceback + Kontext, ohne Schlüssel) statt still zu sterben.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import traceback
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Callable, Iterator

WATCHDOG_TIMEOUT_S = float(os.environ.get("DGS_WATCHDOG_S", "5"))
WATCHDOG_EXIT_CODE = 42
LOG_MAX_BYTES = 1024 * 1024
LOG_BACKUPS = 3


def setup_logging(data_dir: Path | str, verbose: bool = False) -> logging.Logger:
    """Root-Logger: rotierende Datei + Konsole. Mehrfachaufruf-sicher."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("dingelschwing")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    if getattr(logger, "_dgs_configured", False):
        return logger
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    file_handler = RotatingFileHandler(
        data_dir / "gateway.log", maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUPS,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    logger.addHandler(file_handler)
    logger.addHandler(console)
    logger.propagate = False
    logger._dgs_configured = True  # type: ignore[attr-defined]
    return logger


class Watchdog:
    """Überwacht einen Heartbeat; feuert `on_timeout`, wenn er ausbleibt.

    Produktion verdrahtet `on_timeout=None` → Prozess-Exit 42 (Neustart durch
    den Supervisor). Tests übergeben einen Callback und prüfen ohne Exit.
    """

    def __init__(
        self,
        timeout_s: float = WATCHDOG_TIMEOUT_S,
        on_timeout: Callable[[float], None] | None = None,
        name: str = "watchdog",
    ) -> None:
        self._timeout = max(0.05, timeout_s)
        self._on_timeout = on_timeout
        self._name = name
        self._beat = time.monotonic()
        self._stop = threading.Event()
        self._fired = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def beat(self) -> None:
        with self._lock:
            self._beat = time.monotonic()

    def age_s(self) -> float:
        with self._lock:
            return time.monotonic() - self._beat

    @property
    def fired(self) -> bool:
        return self._fired.is_set()

    def start(self) -> "Watchdog":
        self.beat()
        self._thread = threading.Thread(target=self._run, name=self._name, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def _run(self) -> None:
        while not self._stop.wait(timeout=min(1.0, self._timeout / 2)):
            age = self.age_s()
            if age > self._timeout and not self._fired.is_set():
                self._fired.set()
                try:
                    if self._on_timeout is not None:
                        self._on_timeout(age)
                    else:
                        logging.getLogger("dingelschwing").critical(
                            "Watchdog: kein Heartbeat seit %.1f s – Exit %d (Neustart durch Supervisor)",
                            age, WATCHDOG_EXIT_CODE,
                        )
                        os._exit(WATCHDOG_EXIT_CODE)
                except Exception:  # noqa: BLE001 - Watchdog darf nie selbst sterben
                    logging.getLogger("dingelschwing").exception("Watchdog-Callback fehlgeschlagen")
                return


def write_bug_report(
    data_dir: Path | str,
    exc: BaseException,
    context: dict[str, Any] | None = None,
) -> Path:
    """Schreibt Traceback + Kontext (ohne Secrets) nach `data/bug_report_<ts>.json`."""
    import json as _json

    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    path = data_dir / f"bug_report_{ts}.json"
    report = {
        "ts": ts,
        "component": "mobile-ble-gateway",
        "error": f"{type(exc).__name__}: {exc}",
        "traceback": traceback.format_exception(exc),
        "context": context or {},
    }
    path.write_text(_json.dumps(report, indent=2, ensure_ascii=False)[:200_000], encoding="utf-8")
    return path


@contextmanager
def crash_guard(data_dir: Path | str, context: dict[str, Any] | None = None) -> Iterator[None]:
    """Fängt Unbehandeltes, schreibt Bug-Report + Log, wirft dann weiter."""
    try:
        yield
    except KeyboardInterrupt:
        raise
    except BaseException as exc:
        try:
            path = write_bug_report(data_dir, exc, context)
            logging.getLogger("dingelschwing").exception("Unbehandelter Fehler – Bug-Report: %s", path)
        except Exception:  # noqa: BLE001 - letzter Ausweg: stderr
            traceback.print_exc()
        raise


def install_asyncio_handler(loop: Any, audit: Callable[[str, Any], None] | None = None) -> None:
    """Asyncio-Exceptions ins Audit-Log + Logger statt stderr-only."""

    def _handler(_loop: Any, ctx: dict[str, Any]) -> None:
        msg = str(ctx.get("exception", ctx.get("message", "asyncio-fehler")))
        logging.getLogger("dingelschwing").error("asyncio: %s", msg[:500])
        if audit is not None:
            try:
                audit("asyncio_error", msg[:500])
            except Exception:  # noqa: BLE001
                pass

    try:
        loop.set_exception_handler(_handler)
    except Exception:  # noqa: BLE001
        pass
