"""Minimaler RFC6455-WebSocket-Server (nur Standardbibliothek)."""
from __future__ import annotations

import base64
import hashlib
import json
import socket
import struct
import threading
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def accept_key(key: str) -> str:
    digest = hashlib.sha1((key + GUID).encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def encode_frame(data: bytes, opcode: int = 1) -> bytes:
    header = bytearray()
    header.append(0x80 | (opcode & 0x0F))
    n = len(data)
    if n < 126:
        header.append(n)
    elif n < 65536:
        header.append(126)
        header.extend(struct.pack("!H", n))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", n))
    return bytes(header) + data


def decode_frame(sock: socket.socket) -> tuple[int, bytes] | None:
    hdr = _recv_exact(sock, 2)
    if not hdr:
        return None
    opcode = hdr[0] & 0x0F
    masked = bool(hdr[1] & 0x80)
    length = hdr[1] & 0x7F
    if length == 126:
        ext = _recv_exact(sock, 2)
        if not ext:
            return None
        length = struct.unpack("!H", ext)[0]
    elif length == 127:
        ext = _recv_exact(sock, 8)
        if not ext:
            return None
        length = struct.unpack("!Q", ext)[0]
    mask = b""
    if masked:
        mask = _recv_exact(sock, 4) or b""
        if len(mask) < 4:
            return None
    payload = _recv_exact(sock, length) or b""
    if len(payload) < length:
        return None
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        try:
            chunk = sock.recv(n - len(buf))
        except OSError:
            return bytes(buf)
        if not chunk:
            return bytes(buf)
        buf.extend(chunk)
    return bytes(buf)


class WsClient:
    def __init__(self, sock: socket.socket, path: str, query: dict[str, str]) -> None:
        self.sock = sock
        self.path = path
        self.query = query
        self.alive = True
        self._lock = threading.Lock()

    def send_json(self, payload: dict[str, Any]) -> None:
        self.send_text(json.dumps(payload, ensure_ascii=False))

    def send_text(self, text: str) -> None:
        self.send_bytes(text.encode("utf-8"), 1)

    def send_bytes(self, data: bytes, opcode: int = 1) -> None:
        if not self.alive:
            return
        try:
            with self._lock:
                self.sock.sendall(encode_frame(data, opcode))
        except OSError:
            self.alive = False

    def close(self, code: int = 1000, reason: str = "") -> None:
        if not self.alive:
            return
        payload = struct.pack("!H", code) + reason.encode("utf-8")
        try:
            with self._lock:
                self.sock.sendall(encode_frame(payload, 8))
        except OSError:
            pass
        self.alive = False
        try:
            self.sock.close()
        except OSError:
            pass


Handler = Callable[[WsClient], None]


def handshake(conn: socket.socket) -> tuple[str, dict[str, str]] | None:
    raw = b""
    while b"\r\n\r\n" not in raw:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        raw += chunk
        if len(raw) > 65536:
            return None
    try:
        head = raw.decode("iso-8859-1")
    except UnicodeDecodeError:
        return None
    lines = head.split("\r\n")
    if not lines:
        return None
    parts = lines[0].split(" ")
    path = parts[1] if len(parts) >= 2 else "/"
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    key = headers.get("sec-websocket-key")
    if not key:
        return None
    accept = accept_key(key)
    resp = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept}\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "\r\n"
    )
    conn.sendall(resp.encode("ascii"))
    parsed = urlparse(path)
    qs = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    return parsed.path, qs


def serve(bind: str, port: int, handler: Handler, name: str = "ws") -> threading.Thread:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((bind, port))
    sock.listen(32)

    def loop() -> None:
        print(f"{name} WebSocket auf ws://{bind}:{port}", flush=True)
        while True:
            try:
                conn, _addr = sock.accept()
            except OSError:
                break
            threading.Thread(target=_session, args=(conn, handler), daemon=True).start()

    t = threading.Thread(target=loop, daemon=True, name=name)
    t.start()
    return t


def _session(conn: socket.socket, handler: Handler) -> None:
    try:
        hs = handshake(conn)
        if not hs:
            conn.close()
            return
        path, qs = hs
        client = WsClient(conn, path, qs)
        handler(client)
    except Exception:
        try:
            conn.close()
        except OSError:
            pass
