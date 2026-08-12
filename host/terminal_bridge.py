"""Terminal-Bridge (WS :8765) – xterm.js ↔ PTY/SSH.

Protokoll gemäß docs/api-websockets.md:
  Client → Server: {"type":"stdin","data":…}, {"type":"resize","cols","rows"},
                   {"type":"ping"}
  Server → Client: {"type":"stdout","data":…}, {"type":"error","code","message"},
                   {"type":"close","reason"}
RBAC + Interlock + Idle-/Absolut-Timeout werden serverseitig durchgesetzt.
"""
from __future__ import annotations

import os
import pty
import select
import shlex
import subprocess
import threading
import time
from typing import Any, Callable

from . import config

FEHLERCODE_RBAC = "RBAC_DENIED"
FEHLERCODE_DONGLE = "DONGLE_MISSING"
FEHLERCODE_TIMEOUT = "TERMINAL_SESSION_TIMEOUT"
FEHLERCODE_GENERIC = "TERMINAL_SESSION_ERROR"


class TerminalSession:
    """Eine PTY-Session mit Reader-Thread + Timeouts."""

    def __init__(
        self,
        kind: str,
        target: str,
        role: str,
        user: str,
        on_output: Callable[[str], None],
        on_close: Callable[[str], None],
        idle_timeout: int | None = None,
        abs_timeout: int | None = None,
    ) -> None:
        self.kind = kind
        self.target = target
        self.role = role
        self.user = user
        self._on_output = on_output
        self._on_close = on_close
        self._idle_timeout = idle_timeout or config.TERMINAL_IDLE_TIMEOUT_S
        self._abs_timeout = abs_timeout or config.TERMINAL_ABS_TIMEOUT_S
        self._proc: subprocess.Popen | None = None
        self._master_fd: int | None = None
        self._closed = False
        self._lock = threading.Lock()
        self._last_activity = time.time()
        self._started = time.time()

    # ------------------------------------------------------------------
    def open(self) -> tuple[bool, str]:
        try:
            if self.kind == "ssh":
                ok, err = self._open_ssh()
            else:
                ok, err = self._open_pty()
            if ok:
                threading.Thread(target=self._reader, daemon=True).start()
                threading.Thread(target=self._watchdog, daemon=True).start()
            return ok, err
        except Exception as exc:  # noqa: BLE001
            return False, f"{FEHLERCODE_GENERIC}: {exc}"

    def _open_pty(self) -> tuple[bool, str]:
        """Lokale PTY (shell) – BLE-Konsole bzw. Hardware-Shell."""
        master, slave = pty.openpty()
        env = dict(os.environ)
        env["TERM"] = "xterm-256color"
        self._proc = subprocess.Popen(
            [os.environ.get("SHELL", "/bin/sh")],
            stdin=slave, stdout=slave, stderr=slave,
            env=env, close_fds=True,
        )
        os.close(slave)
        self._master_fd = master
        return True, ""

    def _open_ssh(self) -> tuple[bool, str]:
        """SSH-Session via paramiko (optional) oder OpenSSH-Client."""
        host, _, port = self.target.partition(":")
        try:
            import paramiko  # type: ignore
        except ImportError:
            return False, f"{FEHLERCODE_GENERIC}: paramiko nicht installiert"
        self._ssh = paramiko.SSHClient()
        self._ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            key_path = os.path.expanduser("~/.ssh/id_rsa")
            self._ssh.connect(
                host, port=int(port or 22),
                username=self.target_user,
                key_filename=key_path if os.path.isfile(key_path) else None,
                timeout=10,
            )
        except Exception as exc:  # noqa: BLE001
            return False, f"{FEHLERCODE_GENERIC}: SSH-Verbindung fehlgeschlagen: {exc}"
        self._ssh_chan = self._ssh.get_transport().open_session()
        self._ssh_chan.get_pty(term="xterm-256color")
        self._ssh_chan.invoke_shell()
        return True, ""

    # ------------------------------------------------------------------
    def write(self, data: str) -> None:
        self._last_activity = time.time()
        try:
            if getattr(self, "_ssh_chan", None) is not None:
                self._ssh_chan.send(data)
            elif self._master_fd is not None:
                os.write(self._master_fd, data.encode())
        except OSError:
            self.close("PTY geschlossen")

    def resize(self, cols: int, rows: int) -> None:
        try:
            if getattr(self, "_ssh_chan", None) is not None:
                self._ssh_chan.resize_pty(width=cols, height=rows)
            elif self._proc is not None and self._master_fd is not None:
                import fcntl
                import struct
                fcntl.ioctl(self._master_fd, 0x5414,  # TIOCSWINSZ
                            struct.pack("HHHH", rows, cols, 0, 0))
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------------
    def _reader(self) -> None:
        try:
            if getattr(self, "_ssh_chan", None) is not None:
                while not self._closed:
                    if self._ssh_chan.recv_ready():
                        data = self._ssh_chan.recv(4096).decode(errors="replace")
                        self._last_activity = time.time()
                        self._on_output(data)
                    time.sleep(0.02)
            elif self._master_fd is not None:
                while not self._closed:
                    ready, _, _ = select.select([self._master_fd], [], [], 0.2)
                    if ready:
                        data = os.read(self._master_fd, 4096)
                        if not data:
                            break
                        self._last_activity = time.time()
                        self._on_output(data.decode(errors="replace"))
        except OSError:
            pass
        finally:
            self.close("Session beendet")

    def _watchdog(self) -> None:
        while not self._closed:
            now = time.time()
            if now - self._last_activity > self._idle_timeout:
                self.close(f"Idle-Timeout ({self._idle_timeout}s)")
                return
            if now - self._started > self._abs_timeout:
                self.close(f"Absolut-Timeout ({self._abs_timeout}s)")
                return
            time.sleep(5)

    def close(self, reason: str) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        try:
            if getattr(self, "_ssh_chan", None) is not None:
                self._ssh.close()
            if self._proc is not None:
                self._proc.terminate()
            if self._master_fd is not None:
                os.close(self._master_fd)
        except Exception:  # noqa: BLE001
            pass
        self._on_close(reason)

    @property
    def target_user(self) -> str:
        return os.environ.get("USER", "root")
