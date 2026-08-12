"""Echter SSH-Server (userspace, paramiko) – Alternative zu fehlendem sshd.

Ermöglicht echte SSH-Terminal-Sessions der Terminal-Bridge
(kind=network, target=localhost:2222) ohne Root/apt: vollwertiges
SSH-Protokoll (paramiko-Server), Passwort-Auth gegen die Demo-User,
PTY-Allokation und Shell-Ausführung.
"""
from __future__ import annotations

import os
import socket
import threading

import paramiko

HOST_KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "data", "ssh_host_rsa")


class _SSHServer(paramiko.ServerInterface):
    def __init__(self, users: dict[str, str]) -> None:
        self._users = users
        self._event = threading.Event()
        self._exec_command: str | None = None
        self._exec_event = threading.Event()

    def check_auth_password(self, username: str, password: str):
        if username in self._users and self._users[username] == password:
            return paramiko.AUTH_SUCCESSFUL
        return paramiko.AUTH_FAILED

    def get_allowed_auths(self, username: str) -> str:
        return "password"

    def check_channel_request(self, kind, chanid) -> int:
        if kind == "session":
            return paramiko.OPEN_SUCCEEDED
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_shell_request(self, channel) -> bool:
        return True

    def check_channel_exec_request(self, channel, command) -> bool:
        self._exec_command = command.decode() if isinstance(command, bytes) else str(command)
        self._exec_event.set()
        return True

    def check_channel_pty_request(self, channel, term, width, height,
                                  pixelwidth, pixelheight, modes) -> bool:
        return True


class SshServer:
    """Startet einen echten SSH-Server auf 127.0.0.1:2222."""

    def __init__(self, port: int = 2222,
                 users: dict[str, str] | None = None) -> None:
        self.port = port
        self.users = users or {
            "admin": "admin",
            "developer": "dev123",
            "service": "svc123",
        }
        self._thread: threading.Thread | None = None
        self._running = False
        self._host_key = self._load_host_key()

    def _load_host_key(self) -> paramiko.RSAKey:
        os.makedirs(os.path.dirname(HOST_KEY_PATH), exist_ok=True)
        if os.path.isfile(HOST_KEY_PATH):
            return paramiko.RSAKey(filename=HOST_KEY_PATH)
        key = paramiko.RSAKey.generate(2048)
        key.write_private_key_file(HOST_KEY_PATH)
        return key

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", self.port))
        sock.listen(8)
        while self._running:
            try:
                conn, _addr = sock.accept()
                threading.Thread(target=self._handle,
                                 args=(conn,), daemon=True).start()
            except OSError:
                break

    def _handle(self, conn: socket.socket) -> None:
        transport = paramiko.Transport(conn)
        transport.add_server_key(self._host_key)
        server = _SSHServer(self.users)
        transport.start_server(server=server)
        try:
            channel = transport.accept(60)
            if channel is None:
                transport.close()
                return
            import select
            import pty
            import subprocess

            # Kurz auf exec_request warten (kommt direkt nach Channel-Open)
            server._exec_event.wait(1.0)
            # exec_command (Einzelbefehl) → Shell-Ausführung mit Exit-Status
            exec_cmd = server._exec_command
            if exec_cmd:
                proc = subprocess.Popen(exec_cmd, shell=True,
                                        stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT)
                out = proc.stdout.read()
                proc.wait()
                channel.sendall(out)
                channel.send_exit_status(proc.returncode)
                channel.close()
                # Transport offen lassen – Client kann weitere Kanäle öffnen
                return

            # Interaktive PTY-Shell (xterm.js-Terminal)
            master, slave = pty.openpty()
            env = dict(os.environ)
            env["TERM"] = "xterm-256color"
            proc = subprocess.Popen(
                [os.environ.get("SHELL", "/bin/sh")],
                stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)
            os.close(slave)
            try:
                while True:
                    r, _, _ = select.select([channel, master], [], [], 1.0)
                    if channel in r:
                        data = channel.recv(4096)
                        if not data:
                            break
                        os.write(master, data)
                    if master in r:
                        data = os.read(master, 4096)
                        if not data:
                            break
                        channel.sendall(data)
            finally:
                proc.terminate()
                os.close(master)
                channel.close()
        except Exception:  # noqa: BLE001
            pass
        finally:
            transport.close()
            conn.close()


# Singleton
ssh_server = SshServer()
