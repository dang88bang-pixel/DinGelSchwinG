"""DinGelSchwinG · Honeywell-CT45P-Protokollkern (reine Python-Stdlib).

Enthält:
  * Frame-Codec für die TCP-Strecke Haupt-Agent ⇄ mobiles BLE-Gateway
  * AES-128 (ECB/CBC) als reine-Python-Fallback + Krypto-Fallback-Doku
  * Session-Key-Derivation und Challenge/Response des Tokens
  * Whitelist-Verwaltung inkl. Fingerabdruck-Prinzip

Design-Entscheidung „Fingerabdruck statt Schlüssel“:
  Das mobile Gateway (RPi Zero 2 W) soll kompromittierbar sein, ohne dass ein
  Diebstahl alle Token kompromittiert. Deshalb liegen dort nur SHA-256-
  FINGERABDRÜCKE der Root-Keys. Für einen vollen, verifizierbaren Handshake
  braucht der Leser den echten Schlüssel → der wird im Haupt-Agent (RPi 4)
  bzw. einem Vault gehalten und pro Session als *abgeleiteter* Session-Key
  über die TLS-/Loopback-TCP-Strecke angeliefert. Der Gateway muss also keinen
  Root-Key kennen, um zu prüfen: er leitet K_sess aus Challenge + mitgebrachtem
  Session-Material ab und prüft die Antwort des Tokens.
"""
from __future__ import annotations

import hashlib
import hmac
import struct
import time
import zlib
from dataclasses import dataclass, field
from typing import Any

from gw_config import (
    MAGIC,
    PROTO_VERSION,
    T_RESPONSE,
    TYPE_NAMES,
)

# ---------------------------------------------------------------------------
# Frame-Codec (TCP): MAGIC(4) | version(1) | type(1) | length(4, BE) | JSON | crc32(4)
# ---------------------------------------------------------------------------
HEADER = struct.Struct(">4sBB I")
CRC = struct.Struct(">I")


class FrameError(ValueError):
    """Fehler im Leitungprotokoll (Längen/CRC/Version)."""


def encode_frame(msg_type: int, payload: dict[str, Any] | None = None) -> bytes:
    body = (
        __import__("json").dumps(payload or {}, separators=(",", ":"), ensure_ascii=False)
        .encode("utf-8")
    )
    if len(body) > 4_000_000:
        raise FrameError(f"payload zu groß: {len(body)} byte")
    return MAGIC + bytes([PROTO_VERSION, msg_type]) + struct.pack(">I", len(body)) + body + CRC.pack(zlib.crc32(body) & 0xFFFFFFFF)


def decode_frame(raw: bytes) -> tuple[int, dict[str, Any]]:
    """Dekodiert genau EINEN Frame aus `raw` (für Tests/Simulator)."""
    if len(raw) < HEADER.size + CRC.size:
        raise FrameError("frame zu kurz")
    magic, version, msg_type, length = HEADER.unpack(raw[: HEADER.size])
    if magic != MAGIC:
        raise FrameError(f"magic ungültig: {magic!r}")
    if version != PROTO_VERSION:
        raise FrameError(f"protokoll-version {version} nicht unterstützt")
    end = HEADER.size + length
    if len(raw) < end + CRC.size:
        raise FrameError("frame unvollständig")
    body = raw[HEADER.size:end]
    (crc,) = CRC.unpack(raw[end : end + CRC.size])
    if crc != (zlib.crc32(body) & 0xFFFFFFFF):
        raise FrameError("crc-checksumme fehlerhaft")
    import json

    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception as exc:  # noqa: BLE001
        raise FrameError(f"payload kein JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise FrameError("payload muss ein Objekt sein")
    return msg_type, payload


class FrameReader:
    """Inkrementeller Strom-Parser (asyncio `feed_data`)."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self.frames: list[tuple[int, dict[str, Any]]] = []
        self.error: FrameError | None = None

    def feed(self, chunk: bytes) -> list[tuple[int, dict[str, Any]]]:
        self._buf.extend(chunk)
        out: list[tuple[int, dict[str, Any]]] = []
        while True:
            if len(self._buf) < HEADER.size:
                break
            if self._buf[:4] != MAGIC:
                # Resync: bis zum nächsten Magic-Byte springen
                idx = self._buf.find(MAGIC, 1)
                if idx < 0:
                    del self._buf[: max(0, len(self._buf) - 3)]
                    break
                del self._buf[:idx]
                continue
            try:
                magic, version, msg_type, length = HEADER.unpack(bytes(self._buf[: HEADER.size]))
            except struct.error as exc:  # pragma: no cover
                self.error = FrameError(str(exc))
                break
            if version != PROTO_VERSION:
                self.error = FrameError(f"protokoll-version {version} nicht unterstützt")
                self._buf.clear()
                break
            total = HEADER.size + length + CRC.size
            if len(self._buf) < total:
                break
            body = bytes(self._buf[HEADER.size : HEADER.size + length])
            (crc,) = CRC.unpack(bytes(self._buf[HEADER.size + length : total]))
            del self._buf[:total]
            if crc != (zlib.crc32(body) & 0xFFFFFFFF):
                self.error = FrameError("crc-checksumme fehlerhaft")
                continue
            import json

            try:
                payload = json.loads(body.decode("utf-8")) if body else {}
                if not isinstance(payload, dict):
                    raise ValueError("payload kein Objekt")
            except Exception as exc:  # noqa: BLE001
                self.error = FrameError(f"payload ungültig: {exc}")
                continue
            out.append((msg_type, payload))
        self.frames.extend(out)
        return out

    @property
    def buffered(self) -> int:
        return len(self._buf)

    def describe(self, msg_type: int) -> str:
        return TYPE_NAMES.get(msg_type, f"0x{msg_type:02X}")


# ---------------------------------------------------------------------------
# AES-128 – reine Python-Implementierung (Fallback, wenn `cryptography` fehlt)
# ---------------------------------------------------------------------------
_SBOX: list[int] = []
_INV_SBOX = [0] * 256


def _init_tables() -> None:
    global _SBOX
    if _SBOX:
        return
    p = q = 1
    sbox = [0] * 256
    while True:
        # p *= 3 im GF(2^8)
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        # q /= 3 (multiplikative Inverse-Iteration)
        q ^= (q << 1) & 0xFF
        q ^= (q << 2) & 0xFF
        q ^= (q << 4) & 0xFF
        if q & 0x80:
            q ^= 0x09
        value = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4))
        sbox[p] = (value ^ 0x63) & 0xFF
        if p == 1:
            break
    sbox[0] = 0x63
    _SBOX[:] = sbox
    for i, v in enumerate(sbox):
        _INV_SBOX[v] = i


_init_tables()


def _xtime(a: int) -> int:
    a <<= 1
    if a & 0x100:
        a = (a ^ 0x11B) & 0xFF
    return a


def _gmul(a: int, b: int) -> int:
    res = 0
    for _ in range(8):
        if b & 1:
            res ^= a
        b >>= 1
        a = _xtime(a)
    return res & 0xFF


def _key_expansion(key: bytes) -> list[int]:
    if len(key) != 16:
        raise ValueError("AES-128 benötigt einen 16-Byte-Schlüssel")
    words = [list(key[4 * i : 4 * i + 4]) for i in range(4)]
    rcon = 1
    for i in range(4, 44):
        temp = list(words[i - 1])
        if i % 4 == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[b] for b in temp]
            temp[0] ^= rcon
            rcon = _xtime(rcon)
        words.append([w ^ temp[j] for j, w in enumerate(words[i - 4])])
    out: list[int] = []
    for w in words:
        out.extend(w)
    return out


def _add_round_key(state: list[int], rk: list[int], rnd: int) -> None:
    off = rnd * 16
    for i in range(16):
        state[i] ^= rk[off + i]


def _shift_rows_fwd(s: list[int]) -> None:
    t = s[:]
    for r in range(1, 4):
        for c in range(4):
            s[c * 4 + r] = t[((c + r) % 4) * 4 + r]


def _shift_rows_inv(s: list[int]) -> None:
    t = s[:]
    for r in range(1, 4):
        for c in range(4):
            s[((c + r) % 4) * 4 + r] = t[c * 4 + r]


def _mix_cols_fwd(s: list[int]) -> None:
    for c in range(4):
        i = 4 * c
        a0, a1, a2, a3 = s[i], s[i + 1], s[i + 2], s[i + 3]
        s[i] = _gmul(a0, 2) ^ _gmul(a1, 3) ^ a2 ^ a3
        s[i + 1] = a0 ^ _gmul(a1, 2) ^ _gmul(a2, 3) ^ a3
        s[i + 2] = a0 ^ a1 ^ _gmul(a2, 2) ^ _gmul(a3, 3)
        s[i + 3] = _gmul(a0, 3) ^ a1 ^ a2 ^ _gmul(a3, 2)


def _mix_cols_inv(s: list[int]) -> None:
    for c in range(4):
        i = 4 * c
        a0, a1, a2, a3 = s[i], s[i + 1], s[i + 2], s[i + 3]
        s[i] = _gmul(a0, 14) ^ _gmul(a1, 11) ^ _gmul(a2, 13) ^ _gmul(a3, 9)
        s[i + 1] = _gmul(a0, 9) ^ _gmul(a1, 14) ^ _gmul(a2, 11) ^ _gmul(a3, 13)
        s[i + 2] = _gmul(a0, 13) ^ _gmul(a1, 9) ^ _gmul(a2, 14) ^ _gmul(a3, 11)
        s[i + 3] = _gmul(a0, 11) ^ _gmul(a1, 13) ^ _gmul(a2, 9) ^ _gmul(a3, 14)


def _aes_block_enc(block: bytes, rk: list[int]) -> bytes:
    s = list(block)
    _add_round_key(s, rk, 0)
    for rnd in range(1, 10):
        for i in range(16):
            s[i] = _SBOX[s[i]]
        _shift_rows_fwd(s)
        _mix_cols_fwd(s)
        _add_round_key(s, rk, rnd)
    for i in range(16):
        s[i] = _SBOX[s[i]]
    _shift_rows_fwd(s)
    _add_round_key(s, rk, 10)
    return bytes(s)


def _aes_block_dec(block: bytes, rk: list[int]) -> bytes:
    s = list(block)
    _add_round_key(s, rk, 10)
    for rnd in range(9, 0, -1):
        _shift_rows_inv(s)
        for i in range(16):
            s[i] = _INV_SBOX[s[i]]
        _add_round_key(s, rk, rnd)
        _mix_cols_inv(s)
    _shift_rows_inv(s)
    for i in range(16):
        s[i] = _INV_SBOX[s[i]]
    _add_round_key(s, rk, 0)
    return bytes(s)


class _PureAes:
    """Adapter mit `encrypt`/`decrypt` (16-Byte-Block) auf die AES-Funktionen."""

    def __init__(self, key: bytes) -> None:
        self._rk = _key_expansion(key)

    def encrypt(self, block: bytes) -> bytes:
        return _aes_block_enc(block, self._rk)

    def decrypt(self, block: bytes) -> bytes:
        return _aes_block_dec(block, self._rk)


def aes128_cipher(key: bytes):
    """Bevorzugt `cryptography`, sonst reine-Python-Fallback.

    Rückgabe: Objekt mit .encrypt(.decrypt) für 16-Byte-Blöcke plus Flag
    `is_pure_python` (für Warnungen im Dashboard).
    """
    try:  # pragma: no cover - optionaler Pfad
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes  # type: ignore

        ciph = Cipher(algorithms.AES(key), modes.ECB())
        enc = ciph.encryptor()
        dec = ciph.decryptor()

        class _Lib:
            is_pure_python = False

            @staticmethod
            def encrypt(block: bytes) -> bytes:
                return enc.update(block)

            @staticmethod
            def decrypt(block: bytes) -> bytes:
                return dec.update(block)

        return _Lib()
    except Exception:  # noqa: BLE001
        c = _PureAes(key)
        c.is_pure_python = True  # type: ignore[attr-defined]
        return c


def pkcs7_pad(data: bytes, size: int = 16) -> bytes:
    pad = size - (len(data) % size)
    return data + bytes([pad]) * pad


def pkcs7_unpad(data: bytes, size: int = 16) -> bytes:
    if not data or len(data) % size:
        raise ValueError("ungültige PKCS7-Polsterung")
    pad = data[-1]
    if pad < 1 or pad > size or data[-pad:] != bytes([pad]) * pad:
        raise ValueError("ungültige PKCS7-Polsterung")
    return data[:-pad]


def cbc_encrypt(key: bytes, iv: bytes, plaintext: bytes) -> bytes:
    cipher = aes128_cipher(key)
    out = bytearray()
    prev = iv
    for chunk in (pkcs7_pad(plaintext)[i : i + 16] for i in range(0, len(pkcs7_pad(plaintext)), 16)):
        blk = bytes(a ^ b for a, b in zip(chunk, prev))
        prev = cipher.encrypt(blk)
        out += prev
    return bytes(out)


def cbc_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    if len(ciphertext) % 16 or not ciphertext:
        raise ValueError("ciphertext muss ein Vielfaches von 16 byte sein")
    cipher = aes128_cipher(key)
    out = bytearray()
    prev = iv
    for i in range(0, len(ciphertext), 16):
        block = ciphertext[i : i + 16]
        out += bytes(a ^ b for a, b in zip(cipher.decrypt(block), prev))
        prev = block
    return pkcs7_unpad(bytes(out))


# ---------------------------------------------------------------------------
# Honeywell-CT45P-Authentifizierung (modelliert, Annahmen!)
# ---------------------------------------------------------------------------
def token_key_fingerprint(root_key: bytes) -> str:
    """SHA-256-Fingerabdruck, in 4er-Gruppen mit ':' – für Logs/Whitelist."""
    digest = hashlib.sha256(root_key).hexdigest()
    return ":".join(digest[i : i + 4].upper() for i in range(0, 64, 4))


def derive_session_key(root_key: bytes, challenge: bytes, token_id: str) -> bytes:
    """K_sess = HMAC-SHA256(K_root, "dgs-ct45p|token|challenge)[:16] → AES-128."""
    msg = b"dgs-ct45p-v1|" + token_id.encode("utf-8") + b"|" + challenge
    return hmac.new(root_key, msg, hashlib.sha256).digest()[:16]


@dataclass
class Challenge:
    token_id: str
    value: bytes                  # 16 Byte, an das Token gesendet
    iv: bytes                     # 16 Byte
    session_key: bytes            # abgeleitet; Gateway kann damit prüfen
    created: float = field(default_factory=time.time)
    nonce_ok: int | None = None
    attempts: int = 0

    @property
    def expires(self) -> float:
        return self.created + max(1.0, float(__import__("os").environ.get("DGS_CHALLENGE_TTL", "20")))

    def is_expired(self) -> bool:
        return time.time() > self.expires

    def to_public_dict(self) -> dict[str, Any]:
        """Nur das, was der Agent sehen darf (niemals session_key)."""
        return {
            "token_id": self.token_id,
            "challenge": self.value.hex(),
            "iv": self.iv.hex(),
            "created": round(self.created, 3),
            "expires_in_s": round(max(0.0, self.expires - time.time()), 1),
            "attempts": self.attempts,
            "cipher": "AES-128-CBC",
            "kdf": "HMAC-SHA256(CT45P-v1)",
        }


def build_response_plaintext(challenge: bytes, token_id: str, battery_mv: int = 3250, tamper: int = 0) -> bytes:
    """Token-Plaintext: echo(challenge)[16] | id[8] | batt[2BE] | tamper[1] | flags[1]"""
    ident = hashlib.sha256(token_id.encode("utf-8")).digest()[:8]
    return challenge + ident + struct.pack(">HBB", battery_mv & 0xFFFF, tamper & 0xFF, 0x01)


def parse_response_plaintext(data: bytes) -> dict[str, Any]:
    if len(data) < 28:
        raise ValueError("Antwort zu kurz für CT45P-Format")
    echo = data[:16]
    ident = data[16:24]
    battery_mv, tamper, flags = struct.unpack(">HBB", data[24:28])
    return {"echo": echo, "token_hash": ident.hex(), "battery_mv": battery_mv, "tamper": tamper, "flags": flags}


def encrypt_response(root_key: bytes, challenge: Challenge, token_id: str, battery_mv: int = 3250, tamper: int = 0) -> bytes:
    """Simuliert das Token: verschlüsselte Antwort auf die Challenge."""
    key = derive_session_key(root_key, challenge.value, token_id)
    plain = build_response_plaintext(challenge.value, token_id, battery_mv, tamper)
    return cbc_encrypt(key, challenge.iv, plain)


def verify_response(challenge: Challenge, ciphertext: bytes, token_id: str) -> dict[str, Any]:
    """Gateway-Prüfung: Entschlüsselung + Echo-/Identitätsvergleich."""
    try:
        plain = cbc_decrypt(challenge.session_key, challenge.iv, ciphertext)
        parsed = parse_response_plaintext(plain)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": f"decryption_failed: {exc}"}
    expected_ident = hashlib.sha256(token_id.encode("utf-8")).digest()[:8].hex()
    if parsed["echo"] != challenge.value:
        return {"ok": False, "reason": "challenge_mismatch"}
    if parsed["token_hash"] != expected_ident:
        return {"ok": False, "reason": "identity_mismatch"}
    return {
        "ok": True,
        "reason": "authenticated",
        "battery_mv": parsed["battery_mv"],
        "tamper": parsed["tamper"],
        "latency_ms": round((time.time() - challenge.created) * 1000, 1),
    }


def auth_prove_knowledge(root_key: bytes, token_id: str, nonce: bytes, ts: float) -> str:
    """TCP-Ebene: Agent weist nach, den Root-Key zu kennen (bindet Session)."""
    msg = f"auth|{token_id}|{nonce.hex()}|{int(ts)}".encode("utf-8")
    return hmac.new(root_key, msg, hashlib.sha256).hexdigest()


def auth_verify(root_key: bytes, token_id: str, nonce: bytes, ts: float, mac: str) -> bool:
    now = time.time()
    if abs(now - ts) > 300:  # 5 min Zeitfenster
        return False
    expected = auth_prove_knowledge(root_key, token_id, nonce, ts)
    return hmac.compare_digest(expected, mac)
