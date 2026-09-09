"""Tests für das mobile BLE-Gateway (Honeywell-CT45P-Modell).

Läuft ohne Framework (`python3 tests/test_gateway.py`) UND mit pytest.
Alle Krypto-Tests verwenden Vektoren aus FIPS-197 bzw. die Roundtrip-Eigenschaft,
damit die reine-Python-Implementierung nicht gegen sich selbst geprüft wird.
"""
from __future__ import annotations

import json
import os
import secrets
import struct
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import honeywell as H  # noqa: E402
from gw_config import (  # noqa: E402
    T_AUTH,
    T_ERROR,
    T_GRANT,
    T_HELLO,
    T_RESPONSE,
    GatewayConfig,
)
from gateway import GatewayState  # noqa: E402


# ---------------------------------------------------------------------------
# Krypto
# ---------------------------------------------------------------------------
def test_aes128_fips197_vector():
    """FIPS-197 Anhang C.1: AES-128 Blockverschlüsselung."""
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    pt = bytes.fromhex("00112233445566778899aabbccddeeff")
    cipher = H.aes128_cipher(key)
    ct = cipher.encrypt(pt)
    assert ct.hex() == "69c4e0d86a7b0430d8cdb78070b4c55a", ct.hex()
    assert cipher.decrypt(ct) == pt


def test_aes128_fips197_ecb_vector():
    """FIPS-197 Anhang B.2 (Schlüssel 2b7e1516… → a4727e9d…)."""
    key = bytes.fromhex("2b7e151628aed2a6abf7158809cf4f3c")
    pt = bytes.fromhex("6bc1bee22e409f96e93d7e117393172a")
    assert H.aes128_cipher(key).encrypt(pt).hex() == "3ad77bb40d7a3660a89ecaf32466ef97"


def test_aes_wrong_key_length_rejected():
    try:
        H.aes128_cipher(b"\x00" * 15)
    except ValueError as exc:
        assert "16" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("15-Byte-Key hätte abgelehnt werden müssen")


def test_cbc_roundtrip_and_padding():
    key, iv = secrets.token_bytes(16), secrets.token_bytes(16)
    for text in ["x", "y" * 15, "z" * 16, "ärger" * 20]:
        data = text.encode("utf-8")
        assert H.cbc_decrypt(key, iv, H.cbc_encrypt(key, iv, data)) == data


def test_cbc_detects_tampering():
    key, iv = secrets.token_bytes(16), secrets.token_bytes(16)
    ct = bytearray(H.cbc_encrypt(key, iv, b"grant-access-1"))
    ct[-1] ^= 0xFF
    try:
        out = H.cbc_decrypt(bytes(key), iv, bytes(ct))
    except (ValueError, struct.error):
        return  # korrekt abgelehnt
    assert out != b"grant-access-1"


# ---------------------------------------------------------------------------
# Challenge / Response des Tokens
# ---------------------------------------------------------------------------
def _open_challenge(state: GatewayState, key: bytes, token_id: str = "CT45P-0001"):
    res = state.handle_auth({"token_id": token_id, "uid": "04:A2:B3:C1", "session_material": key.hex()}, "test")
    assert res["ok"] and res["mode"] == "gateway_crypto", res
    return res["sid"], state.open_challenges[res["sid"]][1]


def _make_state(tmp_hint: str) -> GatewayState:
    """Isolierte Daten- je Test (eigenes tmp-Verzeichnis pro Test + Prozess)."""
    import atexit
    import shutil

    data = Path("/") / "tmp" / f"dgs-test-{os.getpid()}-{tmp_hint}"
    shutil.rmtree(data, ignore_errors=True)
    data.mkdir(parents=True, exist_ok=True)
    atexit.register(shutil.rmtree, data, True)
    cfg = GatewayConfig.from_env(
        whitelist_file=data / "whitelist.json",
        audit_file=data / "audit.jsonl",
        sessions_file=data / "sessions.json",
        mock=True,
        # Tests rufen handle_auth direkt auf; die Agent-Authentisierung hat
        # eigene Tests (test_agent_proof_*), damit hier nicht jede Krypto-Prüfung
        # an einem fehlenden PSK-Nachweis scheitert.
        require_agent_proof="off",
        agent_secret="",
    )
    state = GatewayState(cfg=cfg, auto_respond=False)
    state.load_whitelist()
    return state


def test_handshake_grants_access():
    state = _make_state("grant")
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    sid, ch = _open_challenge(state, key)
    ct = H.encrypt_response(key, ch, "CT45P-0001", battery_mv=3310, tamper=0)
    verdict = state.handle_response({"sid": sid, "ciphertext": ct.hex()})
    assert verdict["ok"], verdict
    assert verdict["zone"] == "tor-nord"
    assert verdict["battery_mv"] == 3310
    assert verdict["grant"]["relay"] == "open"


def test_handshake_rejects_wrong_key():
    state = _make_state("wrongkey")
    key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    sid, ch = _open_challenge(state, key)
    ct = H.encrypt_response(secrets.token_bytes(16), ch, "CT45P-0001")
    verdict = state.handle_response({"sid": sid, "ciphertext": ct.hex()})
    assert not verdict["ok"]
    assert "decryption_failed" in verdict["reason"]


def test_challenge_is_single_use_and_expired_ttl_denied():
    state = _make_state("replay")
    key = secrets.token_bytes(16)
    sid, ch = _open_challenge(state, key)
    ct = H.encrypt_response(key, ch, "CT45P-0001")
    assert state.handle_response({"sid": sid, "ciphertext": ct.hex()})["ok"]
    # Replay derselben Antwort: Challenge ist geschlossen
    replay = state.handle_response({"sid": sid, "ciphertext": ct.hex()})
    assert not replay["ok"] and replay["reason"] == "unknown_or_expired_sid"
    # Abgelaufene Challenge wird verworfen
    sid2, ch2 = _open_challenge(state, key)
    ch2.created = time.time() - 60
    expired = state.handle_response({"sid": sid2, "ciphertext": H.encrypt_response(key, ch2, "CT45P-0001").hex()})
    assert not expired["ok"] and expired["reason"] == "challenge_expired"


def test_challenge_unpredictable_per_read():
    """Zwei Lesevorgänge desselben Tokens erzeugen verschiedene Chiffretexte."""
    state = _make_state("nonce")
    key = secrets.token_bytes(16)
    sid_a, ch_a = _open_challenge(state, key)
    sid_b, ch_b = _open_challenge(state, key)
    assert ch_a.value != ch_b.value
    ct_a = H.encrypt_response(key, ch_a, "CT45P-0001").hex()
    ct_b = H.encrypt_response(key, ch_b, "CT45P-0001").hex()
    assert ct_a != ct_b
    # A wurde durch B nicht ungültig
    assert state.handle_response({"sid": sid_b, "ciphertext": ct_b})["ok"]


def test_bruteforce_lockout():
    state = _make_state("lockout")
    key = secrets.token_bytes(16)
    for _ in range(state.cfg.max_attempts):
        sid, ch = _open_challenge(state, key, "CT45P-0002")
        state.handle_response({"sid": sid, "ciphertext": secrets.token_bytes(32).hex()})
    assert state.is_locked("CT45P-0002")
    blocked = state.handle_auth({"token_id": "CT45P-0002", "session_material": key.hex()}, "test")
    assert not blocked["ok"] and blocked["reason"] == "locked" and blocked["retry_in_s"] >= 0


def test_whitelist_and_revocation():
    state = _make_state("whitelist")
    key = secrets.token_bytes(16)
    unknown = state.handle_auth({"token_id": "CT45P-UNKNOWN", "session_material": key.hex()}, "test")
    assert not unknown["ok"] and unknown["reason"] == "not_whitelisted"
    state.add_token("CT45P-NEW", label="Neues Tor", zone="hof-c")
    assert state.handle_auth({"token_id": "CT45P-NEW", "session_material": key.hex()}, "test")["ok"]
    assert state.revoke_token("CT45P-NEW")
    revoked = state.handle_auth({"token_id": "CT45P-NEW", "session_material": key.hex()}, "test")
    assert not revoked["ok"] and revoked["reason"] == "revoked"


def test_delegated_mode_without_material():
    """Ohne Session-Material bleibt der Krypto-Teil beim Agenten – kein Blind-Grant."""
    state = _make_state("delegated")
    res = state.handle_auth({"token_id": "CT45P-0001", "uid": "04"}, "test")
    assert res["ok"] and res["mode"] == "delegated"
    assert "challenge" not in res


def test_tamper_locks_out_token():
    state = _make_state("tamper")
    key = secrets.token_bytes(16)
    entry = state.find_token("CT45P-0002")
    entry["max_tamper_count"] = 1
    sid, ch = _open_challenge(state, key, "CT45P-0002")
    ct = H.encrypt_response(key, ch, "CT45P-0002", tamper=2)
    verdict = state.handle_response({"sid": sid, "ciphertext": ct.hex()})
    assert not verdict["ok"] and verdict["reason"] == "tamper_lockout"
    assert state.find_token("CT45P-0002")["revoked"] is True


def test_fingerprint_never_leaks_session_key():
    state = _make_state("privacy")
    key = secrets.token_bytes(16)
    sid, ch = _open_challenge(state, key)
    public = json.dumps(ch.to_public_dict())
    assert ch.session_key.hex() not in public
    assert key.hex() not in public
    assert "session_key" not in public


# ---------------------------------------------------------------------------
# Frame-Codec
# ---------------------------------------------------------------------------
def test_frame_codec_roundtrip_and_fragmentation():
    frames = [H.encode_frame(t, {"i": i, "text": "ärger"}) for i, t in enumerate([T_HELLO, T_AUTH, T_GRANT, T_RESPONSE])]
    stream = b"".join(frames)
    reader = H.FrameReader()
    got = reader.feed(stream)
    assert [m for m, _ in got] == [T_HELLO, T_AUTH, T_GRANT, T_RESPONSE]
    assert got[0][1]["text"] == "ärger"
    # Byte-weise Zufuhr (TCP kann fragmentieren)
    r2 = H.FrameReader()
    total = 0
    for i in range(0, len(stream), 7):
        total += len(r2.feed(stream[i : i + 7]))
    assert total == len(frames), total
    assert r2.error is None


def test_frame_crc_and_magic_hardening():
    f = bytearray(H.encode_frame(T_HELLO, {"a": 1}))
    f[-1] ^= 0xFF
    r = H.FrameReader()
    assert r.feed(bytes(f)) == []
    assert r.error is not None and "crc" in str(r.error).lower()
    # Vermüllter Puffer vor einem gültigen Frame → Resync
    good = H.encode_frame(T_HELLO, {"ok": True})
    r2 = H.FrameReader()
    out = r2.feed(b"\x00garbage" + good)
    assert out and out[0][0] == T_HELLO
    # Falsche Version
    bad = bytearray(H.encode_frame(T_HELLO, {"x": 1}))
    bad[4] = 0x7F
    r3 = H.FrameReader()
    assert r3.feed(bytes(bad)) == []
    assert r3.error is not None and "version" in str(r3.error).lower()


def test_payload_type_errors():
    import json as _json

    body = _json.dumps([1, 2, 3]).encode()
    raw = H.MAGIC + bytes([1, T_ERROR]) + struct.pack(">I", len(body)) + body + struct.pack(">I", __import__("zlib").crc32(body) & 0xFFFFFFFF)
    r = H.FrameReader()
    assert r.feed(raw) == []
    assert r.error is not None


# ---------------------------------------------------------------------------
# Agent-Auth über TCP-Ebene
# ---------------------------------------------------------------------------
def test_agent_hmac_proof_binds_session():
    key = secrets.token_bytes(16)
    nonce = secrets.token_bytes(16)
    ts = time.time()
    mac = H.auth_prove_knowledge(key, "CT45P-0001", nonce, ts)
    assert H.auth_verify(key, "CT45P-0001", nonce, ts, mac)
    assert not H.auth_verify(secrets.token_bytes(16), "CT45P-0001", nonce, ts, mac)
    assert not H.auth_verify(key, "CT45P-0002", nonce, ts, mac)
    # Alter Zeitstempel → kein Replay
    assert not H.auth_verify(key, "CT45P-0001", nonce, ts - 3600, mac)


def test_sessions_are_bounded_and_audit_written():
    state = _make_state("audit")
    key = secrets.token_bytes(16)
    for _ in range(5):
        sid, ch = _open_challenge(state, key)
        state.simulate_token_response(sid, key)
    assert len(state.sessions) <= 200
    audit = state.cfg.audit_file
    assert audit.exists() and audit.stat().st_size > 0
    lines = [json.loads(x) for x in audit.read_text(encoding="utf-8").splitlines() if x.strip()]
    assert any(x["action"] == "granted" for x in lines)


def test_snapshot_and_metrics_shape():
    state = _make_state("metrics")
    key = secrets.token_bytes(16)
    sid, ch = _open_challenge(state, key)
    state.simulate_token_response(sid, key)
    snap = state.snapshot()
    assert snap["ok"] and snap["metrics"]["grants"] >= 1
    assert snap["whitelist"]["count"] >= 1
    text = state.metrics_text()
    assert "dingelschwing_gateway_grants" in text
    assert text.count("\n# ") >= 5  # HELP/TYPE-Paare


def test_agent_proof_required_rejects_anonymous():
    """Ohne Nachweis darf niemand Challenges auslösen (sonst: Whitelist-Missbrauch, Denial-of-Service)."""
    state = _make_state("proof-anon")
    state.cfg.require_agent_proof = "1"
    state.cfg.agent_secret = "22" * 32
    verdict = state.handle_auth({"token_id": "CT45P-0001"}, "curious-scanner")
    assert not verdict["ok"], verdict
    assert verdict["reason"] == "agent_proof_missing", verdict
    assert state.metrics["denies"] >= 1


def test_agent_proof_valid_allows_and_resets_failures():
    secret = bytes.fromhex("22" * 32)
    state = _make_state("proof-ok")
    state.cfg.require_agent_proof = "1"
    state.cfg.agent_secret = secret.hex()
    nonce = secrets.token_bytes(16)
    ts = time.time()
    verdict = state.handle_auth(
        {"token_id": "CT45P-0001", "agent_proof": {"nonce": nonce.hex(), "ts": ts, "mac": H.auth_prove_knowledge(secret, "CT45P-0001", nonce, ts)}},
        "rpi4-main-agent",
    )
    assert verdict["ok"], verdict
    assert verdict["mode"] == "delegated"  # kein Material => Krypto bleibt beim Agenten
    assert state.agent_failures == {}


def test_agent_proof_wrong_secret_and_lockout():
    """Falsches Geheimnis ⇒ abgelehnt; nach der Toleranz ist der Agent suspendiert."""
    state = _make_state("proof-bad")
    state.cfg.require_agent_proof = "1"
    state.cfg.agent_secret = "22" * 32
    state.cfg.agent_max_bad_proofs = 2
    forged = bytes.fromhex("33" * 32)
    nonce = secrets.token_bytes(16)
    ts = time.time()
    for _ in range(2):
        verdict = state.handle_auth(
            {"token_id": "CT45P-0001", "agent_proof": {"nonce": nonce.hex(), "ts": ts, "mac": H.auth_prove_knowledge(forged, "CT45P-0001", nonce, ts)}},
            "attacker-agent",
        )
        assert not verdict["ok"] and verdict["reason"] == "agent_proof_invalid", verdict
    suspended = state.handle_auth({"token_id": "CT45P-0001"}, "attacker-agent")
    assert suspended["reason"] == "agent_suspended", suspended
    assert state.snapshot()["agent_auth"]["bad_proofs"] >= 2
    # korrekt signierter Agent bleibt unberührt von der Sperre eines anderen
    good = bytes.fromhex("22" * 32)
    n2 = secrets.token_bytes(16)
    ok = state.handle_auth(
        {"token_id": "CT45P-0001", "agent_proof": {"nonce": n2.hex(), "ts": time.time(), "mac": H.auth_prove_knowledge(good, "CT45P-0001", n2, time.time())}},
        "honest-agent",
    )
    assert ok["ok"], ok


def test_agent_proof_stale_timestamp_rejected():
    secret = bytes.fromhex("22" * 32)
    state = _make_state("proof-stale")
    state.cfg.require_agent_proof = "1"
    state.cfg.agent_secret = secret.hex()
    nonce = secrets.token_bytes(16)
    old = time.time() - 3600  # außerhalb des 5-min-Zeitfensters
    verdict = state.handle_auth(
        {"token_id": "CT45P-0001", "agent_proof": {"nonce": nonce.hex(), "ts": old, "mac": H.auth_prove_knowledge(secret, "CT45P-0001", nonce, old)}},
        "rpi4-main-agent",
    )
    assert not verdict["ok"] and verdict["reason"] == "agent_proof_invalid", verdict
    # Proof bindet die Token-ID: gleicher MAC mit anderem Token ⇒ ungültig
    ts = time.time()
    mac = H.auth_prove_knowledge(secret, "CT45P-0001", nonce, ts)
    other = state.handle_auth(
        {"token_id": "CT45P-0002", "agent_proof": {"nonce": nonce.hex(), "ts": ts, "mac": mac}},
        "rpi4-main-agent",
    )
    assert not other["ok"], other


def test_shared_secret_from_keys_file(tmp=None):
    """PSK wird aus data/keys.json gelesen (chmod 600 erwartet) – nie aus der Whitelist."""
    data = Path("/") / "tmp" / f"dgs-proof-{os.getpid()}"
    data.mkdir(parents=True, exist_ok=True)
    keyfile = data / "keys.json"
    keyfile.write_text(json.dumps({"shared_secret": "22" * 32}), encoding="utf-8")
    cfg = GatewayConfig.from_env(whitelist_file=data / "whitelist.json", agent_secret_file=keyfile, agent_secret="")
    assert cfg.shared_secret() == bytes.fromhex("22" * 32)
    # Fehlerhafte Länge ⇒ ignoriert (kein Teilgeheimnis-Raten)
    keyfile.write_text(json.dumps({"shared_secret": "deadbeef"}), encoding="utf-8")
    assert cfg.shared_secret() is None



# ---------------------------------------------------------------------------
# PortView (automatische Port-Findung) + Software-Grabber (URL-Import)
# ---------------------------------------------------------------------------
def _tmp_dir(hint: str) -> Path:
    import atexit
    import shutil

    data = Path("/") / "tmp" / f"dgs-{hint}-{os.getpid()}"
    shutil.rmtree(data, ignore_errors=True)
    data.mkdir(parents=True, exist_ok=True)
    atexit.register(shutil.rmtree, data, True)
    return data


def _serve_dir(root: Path):
    """Kleiner Datei-Server als „externes Netz“ für den Grabber."""
    import threading
    from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

    class Quiet(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, fmt, *args):  # Tests sollen leise laufen
            pass

    srv = ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=srv.serve_forever, name="test-http", daemon=True).start()
    return srv, srv.server_address[1]


def test_portview_announce_answers_only_our_magic():
    import discovery

    responder = discovery.DiscoveryResponder(
        discovery.build_announce(http_port=8791, tcp_port=8765, bridge_port=8790, discover_port=18791),
        port=1,
    )
    answer = responder.handle_datagram(b'DGS_DISCOVER {"nonce":"cafe01"}')
    assert answer and answer["ports"]["http"] == 8791 and answer["nonce"] == "cafe01", answer
    assert answer["product"] == "DinGelSchwinG" and answer["service"] == "dingelschwing-gateway"
    assert responder.handle_datagram(b"HALLO") is None          # fremde Pakete: keine Antwort
    assert responder.handle_datagram(b"DGS_DISCOVER {kaputt") is not None  # kaputtes JSON: trotzdem Antwort
    assert responder.status()["answers"] == 2


def test_portview_udp_roundtrip_on_loopback():
    import discovery

    port = 0
    import socket as _s
    with _s.socket(_s.AF_INET, _s.SOCK_DGRAM) as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    responder = discovery.DiscoveryResponder(discovery.build_announce(http_port=28791, tcp_port=28765), port=port)
    if not responder.start():
        return  # Sandbox ohne UDP-Bind: Fallback (HTTP-Probe) ist der reguläre Weg
    try:
        hits = discovery.udp_probe(port=port, timeout=1.0, hosts=["127.0.0.1"])
    finally:
        responder.stop()
    assert hits, hits
    assert hits[0]["ports"]["http"] == 28791, hits[0]
    assert hits[0]["_via"] == "udp" and responder.status()["answers"] >= 1


def test_import_url_guard_blocks_unsafe_targets():
    import importer

    policy = importer.ImportPolicy()
    for url, reason in (
        ("file:///etc/passwd", "schema_nicht_erlaubt"),
        ("data:text/css,*", "schema_nicht_erlaubt"),
        ("ftp://host/x.css", "schema_nicht_erlaubt"),
        ("http://169.254.169.254/latest/meta-data/", "host_gesperrt"),
        ("http://[fe80::1]/x.css", "host_gesperrt"),
        ("kein-host-url", "schema_nicht_erlaubt"),
        ("http://127.0.0.1:9/x", None),
    ):
        verdict = importer.check_url(url, policy)
        if reason is None:
            assert verdict["ok"], (url, verdict)
        else:
            assert verdict["error"] == reason, (url, verdict)
    hard = importer.ImportPolicy(allow_private=False, allow_loopback=False)
    assert importer.check_url("http://127.0.0.1:8791/x", hard)["error"] == "loopback_blockiert"
    assert importer.check_url("http://10.0.0.9/x.css", hard)["error"] == "privatnetz_blockiert"
    assert importer.check_url("http://10.0.0.9/x.css", policy)["ok"]


def test_importer_category_and_filename_rules():
    import importer

    assert importer.detect_category("loop_4bar.wav", "audio/wav", "") == ("beats", True)
    assert importer.detect_category("one_shot_kick.wav", "audio/wav", "")[0] == "samples"
    assert importer.detect_category("dark-ui.css", "text/css", "")[0] == "styles"
    assert importer.detect_category("cinem_lut.cube", "", "https://x/y/lut.cube")[0] == "filters"
    assert importer.detect_category("hall-reverb.jsfx", "application/json", "")[0] == "effects"
    assert importer.detect_category("hinweise.md", "text/plain", "")[0] == "effects"
    assert importer.detect_category("unbekannt.bin", "application/octet-stream", "")[0] == "other"
    assert importer.safe_filename("../../etc/passwd") == "passwd.bin"
    assert importer.safe_filename("a?b=1.zip") == "a.bin"
    assert importer.safe_filename("") == "asset.bin"
    assert ".." not in importer.safe_filename("..%2f..%2fboot.ini")
    assert len(importer.safe_filename("x" * 400 + ".css")) <= 121


def test_import_store_roundtrip_pack_dedupe_and_limit():
    import importer

    root = _tmp_dir("imports")
    (root / "kicks").mkdir()
    (root / "kicks" / "loop_4bar.wav").write_bytes(b"RIFFxxxxWAVE-data-beat" * 8)
    (root / "theme.css").write_text(":root { --bg: #020617; }\n", encoding="utf-8")
    (root / "big.bin").write_bytes(b"x" * 5000)
    (root / "pack.json").write_text(
        json.dumps(
            {
                "dingelschwing_pack": 1,
                "name": "Werkhof-Demo",
                "category": "beats",
                "items": [
                    {"url": "kicks/loop_4bar.wav", "title": "Rampe 4/4", "tags": ["loop", "hall"]},
                    {"url": "theme.css", "title": "Dunkel", "tags": ["css"]},
                    {"url": "file:///etc/passwd", "title": "sollte blockiert werden"},
                ],
            }
        ),
        encoding="utf-8",
    )
    srv, port = _serve_dir(root)
    base = "http://127.0.0.1:%d" % port
    try:
        store = importer.ImportStore(root=root / "katalog", policy=importer.ImportPolicy(max_bytes=4096))
        beat = store.import_url(base + "/kicks/loop_4bar.wav", tags=["werk"])
        assert beat["ok"] and beat["imported"][0]["category"] == "beats", beat
        assert beat["imported"][0]["bytes"] == 176 and beat["imported"][0]["tags"] == ["werk"]
        css = store.import_url(base + "/theme.css")
        assert css["ok"] and css["imported"][0]["category"] == "styles", css

        again = store.import_url(base + "/kicks/loop_4bar.wav")
        assert again["ok"] and again.get("deduped") and again["imported"][0]["id"] == beat["imported"][0]["id"], again

        big = store.import_url(base + "/big.bin")
        assert not big["ok"] and big["error"] == "zu_gross", big

        pack = store.import_url(base + "/pack.json")
        assert pack["ok"] and pack["kind"] == "pack" and len(pack["imported"]) == 2, pack
        assert pack["imported"][0]["pack"] == "Werkhof-Demo"
        assert pack["skipped"] and pack["skipped"][0]["reason"] == "schema_nicht_erlaubt", pack["skipped"]

        listed = store.list()
        assert len(listed) == 2 and listed[0]["imported_at"] >= listed[-1]["imported_at"], listed
        assert any(x.get("pack") == "Werkhof-Demo" for x in listed), listed
        stats = store.stats()
        # beat + css = 2 Dateien; die Pack-Einträge treffen auf denselben Hash (dedupe)
        assert stats["count"] == 2 and stats["deduped"] == 3 and stats["errors"] == 2, stats
        assert stats["packs"] == 1 and stats["imports"] == 2, stats
        path, entry = store.file_for(beat["imported"][0]["id"])
        assert path.is_file() and path.read_bytes().startswith(b"RIFF") and entry["mime"]
        assert store.file_for("../../../etc/passwd") is None
        assert store.delete(beat["imported"][0]["id"]) is True
        assert store.file_for(beat["imported"][0]["id"]) is None
        assert store.delete(beat["imported"][0]["id"]) is False
        assert store.list()[0]["id"] != beat["imported"][0]["id"]
    finally:
        srv.shutdown()
        srv.server_close()


def test_import_block_is_audited():
    import importer

    seen: list = []
    store = importer.ImportStore(
        root=_tmp_dir("imports-audit") / "katalog",
        policy=importer.ImportPolicy(),
        audit=lambda action, detail: seen.append((action, detail)),
    )
    assert not store.import_url("file:///etc/shadow")["ok"]
    assert seen and seen[-1][0] == "import_blocked" and seen[-1][1]["reason"] == "schema_nicht_erlaubt", seen


def test_snapshot_reports_portview_and_import_catalog():
    import discovery
    import importer

    state = _make_state("portview")
    view = state.snapshot()
    assert view["product"] == "DinGelSchwinG", view.get("product")
    assert view["ports"]["http"] == state.cfg.http_port and view["ports"]["bridge"] == 8790
    assert view["portview"]["service"] == "dingelschwing-gateway"
    assert view["portview"]["udp_discovery"] is True
    assert "imports" not in view["portview"]        # ohne Grabber kein Katalogblock
    state.imports = importer.ImportStore(root=_tmp_dir("imports-snap") / "katalog", policy=importer.ImportPolicy())
    text = state.metrics_text()
    assert "dingelschwing_gateway_import_assets 0" in text, text
    state.portview = discovery.DiscoveryResponder(discovery.build_announce(http_port=1), port=1)
    assert "dingelschwing_gateway_portview_answers 0" in state.metrics_text()

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
    print(f"\n{len(tests) - failures}/{len(tests)} tests bestanden")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
