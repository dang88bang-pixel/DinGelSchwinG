"""DinGelSchwinG · Gateway-Kern: Sitzungs-Maschine, Whitelist, Metriken.

Ablauf eines Lesevorgangs (Korrektur des „einfachen NFC-Relay“-Modells):

    NFC-Karte ──PN532──▶ Haupt-Agent (RPi 4)
                            │  UID gegen Whitelist, Session-Key ableiten
                            ▼   TCP-Frame AUTH {token_id, uid, proof, session?}
                        Mobiles BLE-Gateway
                            │  1) prüft Agent-Nachweis (HMAC)  → ohne Nachweis: DENY
                            │  2) baut Challenge (AES-128-CBC, 20 s TTL)
                            ▼   BLE GATT: Write auf challenge_char
                        CT45P Xon+  ( Peripheral, antwortet nur bei korrekter
                            │          Challenge )  Notify auf response_char
                            ▼
                        Gateway prüft Echo+Identität → GRANT / DENY
                            │  Audit-JSONL + WS/HTTP-Push + Prometheus
                            ▼
                        Haupt-Agent → Relais/Gate

Das Gateway ist bewusst NICHT vertrauenswürdig für Schlüssel: es hält nur
Fingerabdrücke und pro Session den abgeleiteten Session-Key.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import socket
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import honeywell as H
from ble_adapter import BleAdapter
from gw_config import (
    AUTO_ENROLL,
    T_RESPONSE,
    LOCKOUT_SECONDS,
    MAX_ATTEMPTS,
    CHAR_CHALLENGE_UUID,
    CHAR_RESPONSE_UUID,
    STATUS_FAIL,
    STATUS_IDLE,
    STATUS_SUCCESS,
    STATUS_TAMPER,
    STATUS_WAITING,
    T_AUTH,
    T_AUTH_ACK,
    T_CHALLENGE,
    T_COMMAND,
    T_DENY,
    T_ERROR,
    T_EVENT,
    T_GRANT,
    T_HELLO,
    T_HELLO_ACK,
    T_PING,
    T_PONG,
    T_STATUS,
    T_STATUS_SNAP,
    ensure_whitelist,
    save_json,
)


@dataclass
class Session:
    """Ein Lesevorgang von AUTH bis GRANT/DENY."""

    sid: str
    token_id: str
    uid: str = ""
    zone: str = ""
    state: str = "pending"          # pending|challenged|granted|denied|locked
    reason: str = ""
    created: float = field(default_factory=time.time)
    finished: float | None = None
    attempts: int = 0
    agent: str = "unknown"
    battery_mv: int | None = None
    tamper: int | None = None
    rssi: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sid": self.sid,
            "token_id": self.token_id,
            "uid": self.uid,
            "zone": self.zone,
            "state": self.state,
            "reason": self.reason,
            "created": round(self.created, 3),
            "duration_ms": round(((self.finished or time.time()) - self.created) * 1000, 1),
            "attempts": self.attempts,
            "agent": self.agent,
            "battery_mv": self.battery_mv,
            "tamper": self.tamper,
            "rssi": self.rssi,
        }


@dataclass
class GatewayState:
    """Geteilter Zustand (TCP-Server, HTTP-Server, Agent-Tools)."""

    cfg: Any
    whitelist: dict = field(default_factory=dict)
    sessions: "deque[Session]" = field(default_factory=lambda: deque(maxlen=200))
    open_challenges: dict[str, tuple[Session, H.Challenge]] = field(default_factory=dict)
    session_material: dict[str, bytes] = field(default_factory=dict)   # sid → K_root (nur RAM!)
    locks: dict[str, float] = field(default_factory=dict)              # token_id → unlock_ts
    failures: dict[str, dict] = field(default_factory=dict)            # token_id → {n, ts}
    events: "deque[dict]" = field(default_factory=lambda: deque(maxlen=500))
    clients: set = field(default_factory=set)                          # verbundene Agenten
    http_watchers: set = field(default_factory=set)                     # SSE
    metrics: dict[str, int] = field(
        default_factory=lambda: {
            "auth_requests": 0,
            "grants": 0,
            "denies": 0,
            "failed_macs": 0,
            "ble_writes": 0,
            "ble_notify": 0,
            "tamper_events": 0,
            "scans": 0,
            "tokens_seen": 0,
            "agent_proof_failures": 0,
            "imports": 0,
            "import_errors": 0,
            "import_bytes": 0,
        }
    )
    started_at: float = field(default_factory=time.time)
    last_maintenance_error: str = ""
    agent_failures: dict[str, dict] = field(default_factory=dict)        # agent → {n, ts}
    ble: BleAdapter | None = None
    portview: Any | None = None                    # discovery.DiscoveryResponder | None
    imports: Any | None = None                     # importer.ImportStore | None
    auto_respond: bool = True     # Mock-Modus: Gateway lässt den Simulator sofort antworten
    _seq: int = 0

    # -- Whitelist -------------------------------------------------------
    def load_whitelist(self) -> None:
        from pathlib import Path as _P

        # Pfade normalisieren (CLI/Tests dürfen Strings übergeben)
        self.cfg.whitelist_file = _P(str(self.cfg.whitelist_file))
        self.cfg.audit_file = _P(str(self.cfg.audit_file))
        self.cfg.sessions_file = _P(str(self.cfg.sessions_file))
        self.whitelist = ensure_whitelist(self.cfg.whitelist_file)
        self._known = {t["token_id"] for t in self.whitelist.get("tokens", []) if not t.get("revoked")}
        self.load_snapshot()  # Phase 3: Sitzungsverlauf überdauert Neustarts

    # -- Session-Snapshot (Phase 3: persistent statt In-Memory-Only) --------
    # Bewusst OHNE Schlüsselmaterial (session_material) und OHNE offene
    # Challenges: Beides ist nur-RAM (TTL) und darf nie auf Disk landen.
    def save_snapshot(self) -> None:
        """Schreibt beendete Sessions + Locks + Zähler atomar nach sessions.json."""
        try:
            from pathlib import Path as _P

            snap = {
                "saved_at": time.time(),
                "sessions": [s.to_dict() for s in self.sessions
                             if s.state in ("granted", "denied", "locked")][-200:],
                "locks": {k: v for k, v in self.locks.items() if v > time.time()},
                "failures": self.failures,
                "metrics": self.metrics,
            }
            save_json(_P(str(self.cfg.sessions_file)), snap)
        except Exception as exc:  # noqa: BLE001 - Persistenz darf nie crashen
            print(f"[gateway] ⚠️  snapshot schreiben fehlgeschlagen: {exc}")

    def load_snapshot(self) -> None:
        """Stellt Verlauf aus sessions.json wieder her (Best-Effort, validiert)."""
        try:
            from pathlib import Path as _P

            path = _P(str(self.cfg.sessions_file))
            if not path.exists():
                return
            snap = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(snap, dict):
                return
            restored = 0
            for item in snap.get("sessions", [])[-200:]:
                if not isinstance(item, dict) or not item.get("sid"):
                    continue
                try:
                    self.sessions.append(Session(
                        sid=str(item["sid"]),
                        token_id=str(item.get("token_id", "")),
                        uid=str(item.get("uid", "")),
                        zone=str(item.get("zone", "")),
                        state=str(item.get("state", "denied")),
                        reason=str(item.get("reason", "")) + " (restart)",
                        created=float(item.get("created", time.time())),
                        finished=item.get("finished"),
                        attempts=int(item.get("attempts", 0)),
                        agent=str(item.get("agent", "unknown")),
                        battery_mv=item.get("battery_mv"),
                        tamper=item.get("tamper"),
                        rssi=item.get("rssi"),
                    ))
                    restored += 1
                except (TypeError, ValueError):
                    continue
            now = time.time()
            for token_id, unlock_ts in (snap.get("locks") or {}).items():
                try:
                    if float(unlock_ts) > now:
                        self.locks[str(token_id)] = float(unlock_ts)
                except (TypeError, ValueError):
                    continue
            if isinstance(snap.get("metrics"), dict):
                for key, val in snap["metrics"].items():
                    if key in self.metrics and isinstance(val, (int, float)):
                        self.metrics[key] = int(val)
            if restored:
                print(f"[gateway] snapshot geladen: {restored} sessions, "
                      f"{len(self.locks)} locks ({path})")
        except Exception as exc:  # noqa: BLE001 - korrupter Snapshot ist ok
            print(f"[gateway] ⚠️  snapshot laden fehlgeschlagen ({exc}) – leer starten")

    def tokens(self) -> list[dict]:
        out = []
        for t in self.whitelist.get("tokens", []):
            item = dict(t)
            item["locked"] = self.locks.get(t["token_id"], 0) > time.time()
            item["recent"] = [s.to_dict() for s in list(self.sessions)[-25:] if s.token_id == t["token_id"]][-5:]
            out.append(item)
        return out

    def find_token(self, token_id: str) -> dict | None:
        for t in self.whitelist.get("tokens", []):
            if t.get("token_id") == token_id:
                return t
        return None

    def add_token(self, token_id: str, label: str = "", zone: str = "default", fingerprint: str = "") -> dict:
        existing = self.find_token(token_id)
        if existing:
            existing.update({"label": label or existing.get("label", ""), "zone": zone or existing.get("zone", "")})
            if fingerprint:
                existing["key_fingerprint"] = fingerprint
            save_json(self.cfg.whitelist_file, self.whitelist)
            return existing
        entry = {
            "token_id": token_id,
            "label": label or token_id,
            "key_fingerprint": fingerprint,
            "zone": zone or "default",
            "roles": ["operator"],
            "tamper_count": 0,
            "max_tamper_count": 0,
            "revoked": False,
        }
        self.whitelist.setdefault("tokens", []).append(entry)
        save_json(self.cfg.whitelist_file, self.whitelist)
        self.push_event("token_added", {"token_id": token_id, "zone": entry["zone"]})
        return entry

    def revoke_token(self, token_id: str, revoked: bool = True) -> bool:
        entry = self.find_token(token_id)
        if not entry:
            return False
        entry["revoked"] = revoked
        save_json(self.cfg.whitelist_file, self.whitelist)
        self.push_event("token_revoked" if revoked else "token_restored", {"token_id": token_id})
        return True

    # -- Audit & Events ---------------------------------------------------
    def audit(self, action: str, detail: dict | str) -> None:
        rec = {"ts": round(time.time(), 3), "action": action, "detail": detail}
        self.push_event(action, detail if isinstance(detail, dict) else {"info": str(detail)})
        try:
            self.cfg.audit_file.parent.mkdir(parents=True, exist_ok=True)
            with self.cfg.audit_file.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception as exc:  # noqa: BLE001 - Audit darf nie den Dienst kippen
            print(f"[gateway] ⚠️  audit schreiben fehlgeschlagen: {exc}")

    def next_sid(self) -> str:
        self._seq = (self._seq + 1) % 0xFFFF
        return f"S{int(time.time()):08X}-{self._seq:04X}-{secrets.token_hex(2)}"

    def push_event(self, kind: str, payload: dict) -> None:
        self.events.appendleft({"ts": time.time(), "kind": kind, **payload})
        frame = H.encode_frame(T_EVENT, {"kind": kind, **payload})
        for writer in list(self.clients):
            try:
                writer.write(frame)
            except Exception:  # noqa: BLE001
                self.clients.discard(writer)
        for queue in list(self.http_watchers):
            try:
                queue.put_nowait({"kind": kind, **payload})
            except Exception:  # noqa: BLE001
                self.http_watchers.discard(queue)

    # -- Aufräumen ----------------------------------------------------------
    def sweep_expired(self) -> int:
        """Schließt Challenges, deren TTL ablief (kein Zombie-Eintrag, kein Leak)."""
        expired = [sid for sid, item in self.open_challenges.items() if item and item[1].is_expired()]
        for sid in expired:
            self._close(sid, "denied", "challenge_expired")
            self.metrics["denies"] += 1
            self.audit("challenge_expired", {"sid": sid})
        return len(expired)

    async def maintenance_loop(self, interval: float = 2.0) -> None:
        """Hintergrundjob: TTL-Sweep + Heartbeat-Event alle `interval` Sekunden."""
        ticks = 0
        while True:
            try:
                self.sweep_expired()
                ticks += 1
                if ticks % 15 == 0:
                    self.push_event(
                        "heartbeat",
                        {
                            "uptime_s": round(time.time() - self.started_at, 1),
                            "grants": self.metrics["grants"],
                            "denies": self.metrics["denies"],
                            "agent_auth": self.agent_auth_summary(),
            "open_challenges": len([v for v in self.open_challenges.values() if v]),
            "simulated_token": bool(self.cfg.mock),
            "last_maintenance_error": self.last_maintenance_error or None,
                            "mock": bool(self.cfg.mock),
                        },
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - Wartung darf den Dienst nicht beenden
                self.last_maintenance_error = str(exc)
            await asyncio.sleep(interval)

    # -- Kern: Autorisierung ------------------------------------------------
    def is_locked(self, token_id: str) -> bool:
        return self.locks.get(token_id, 0) > time.time()

    # ── Agent-Nachweis ──────────────────────────────────────────────────────
    def check_agent_proof(self, payload: dict, agent_name: str) -> tuple[bool, str]:
        """Prüft `agent_proof` gegen das geteilte Agent-Geheimnis (PSK).

        Regel: `auto` ⇒ prüfen, sobald ein Geheimnis hinterlegt ist; `1` ⇒ immer
        (ohne Geheimnis =deny, damit niemand unbemerkt Challenges auslöst); `0` ⇒ aus.
        Das Token-Material (`session_material`) bleibt davon unberührt und wird nie
        zur Agent-Authentisierung benutzt.
        """
        mode = str(getattr(self.cfg, "require_agent_proof", "auto") or "auto").lower()
        secret = None
        if mode != "off":
            try:
                secret = self.cfg.shared_secret()
            except Exception as exc:  # noqa: BLE001
                self.last_maintenance_error = f"agent-secret: {exc}"
        if secret is None:
            if mode in ("1", "true", "yes", "on"):
                return False, "agent_secret_missing"
            return True, ""
        proof = payload.get("agent_proof") or payload.get("proof")
        if not isinstance(proof, dict):
            return False, "agent_proof_missing"
        try:
            nonce = bytes.fromhex(str(proof.get("nonce", "")).replace(" ", ""))
            ts = float(proof.get("ts", 0))
            mac = str(proof.get("mac", ""))
        except (TypeError, ValueError):
            return False, "agent_proof_malformed"
        if len(nonce) < 8 or not mac:
            return False, "agent_proof_malformed"
        token_id = str(payload.get("token_id") or payload.get("uid") or "").strip()
        if not H.auth_verify(secret, token_id, nonce, ts, mac):
            return False, "agent_proof_invalid"
        return True, ""

    def note_agent_failure(self, agent_name: str) -> None:
        rec = self.agent_failures.setdefault(agent_name, {"n": 0, "ts": 0.0})
        rec["n"] += 1
        rec["ts"] = time.time()
        self.metrics["agent_proof_failures"] += 1
        self.audit("agent_proof_failed", {"agent": agent_name, "n": rec["n"]})

    def agent_is_suspended(self, agent_name: str) -> bool:
        rec = self.agent_failures.get(agent_name)
        if not rec:
            return False
        limit = int(getattr(self.cfg, "agent_max_bad_proofs", MAX_ATTEMPTS) or MAX_ATTEMPTS)
        if rec["n"] < limit:
            return False
        if time.time() - rec["ts"] > (self.cfg.lockout_seconds if getattr(self.cfg, "lockout_seconds", None) else LOCKOUT_SECONDS):
            self.agent_failures.pop(agent_name, None)
            return False
        return True

    def handle_auth(self, payload: dict, agent_name: str = "agent") -> dict:
        """AUTH → (AUTH_ACK + Challenge) oder DENY. `session_key`/`root_key` optional.

        Zwei Betriebsarten:
          * `session_material` enthält K_root (Agent liefert ihn nach HMAC-Nachweis)
            → Gateway kann vollständigen Handshake fahren (Demo/Betrieb am RPi 4).
          * ohne Material → Gateway prüft nur Whitelist + Sperrstatus und weist
            den Agenten an, den Krypto-Teil selbst zu führen (`delegated`).

        Vor allem aber: **der Agent selbst wird geprüft** (`check_agent_proof`),
        sonst kann jeder, der Port 8765/8791 erreichen kann, Challenges auslösen,
        Whitelist-Einträge anlegen (auto-enroll) und Tokens per Fehlversuch sperren.
        """
        self.metrics["auth_requests"] += 1
        if self.agent_is_suspended(agent_name):
            self.metrics["denies"] += 1
            return {"ok": False, "reason": "agent_suspended", "agent": agent_name}
        ok, why = self.check_agent_proof(payload, agent_name)
        if not ok:
            self.metrics["denies"] += 1
            self.note_agent_failure(agent_name)
            return {"ok": False, "reason": why, "agent": agent_name}
        self.agent_failures.pop(agent_name, None)
        token_id = str(payload.get("token_id") or payload.get("uid") or "").strip()
        uid = str(payload.get("uid") or "")
        if not token_id:
            self.metrics["denies"] += 1
            return {"ok": False, "reason": "missing_token_id"}

        if self.is_locked(token_id):
            self.metrics["denies"] += 1
            wait = int(self.locks[token_id] - time.time())
            return {"ok": False, "reason": "locked", "retry_in_s": wait}

        entry = self.find_token(token_id)
        if entry is None:
            if not (AUTO_ENROLL or self.cfg.auto_enroll):
                self.metrics["denies"] += 1
                self.audit("auth_deny_unknown", {"token_id": token_id, "uid": uid})
                return {"ok": False, "reason": "not_whitelisted"}
            entry = self.add_token(token_id, label=f"auto-enroll {uid[:12]}", zone="auto")
            self.audit("auto_enroll", {"token_id": token_id})

        if entry.get("revoked"):
            self.metrics["denies"] += 1
            self.audit("auth_deny_revoked", {"token_id": token_id})
            return {"ok": False, "reason": "revoked"}

        material = payload.get("session_material") or payload.get("root_key")
        sid = self.next_sid()
        session = Session(sid=sid, token_id=token_id, uid=uid, zone=entry.get("zone", ""), agent=agent_name)
        self.sessions.append(session)
        self.open_challenges[sid] = None  # placeholder, unten ersetzt

        if not material:
            session.state = "delegated"
            session.reason = "agent_krypto_delegated"
            self.open_challenges.pop(sid, None)
            self.audit("auth_delegated", {"sid": sid, "token_id": token_id})
            return {
                "ok": True,
                "sid": sid,
                "mode": "delegated",
                "note": "Whitelist ok. Kein Session-Material geliefert – führe Challenge/Response im Agenten und melde das Ergebnis als COMMAND grant.",
            }

        root_key = bytes.fromhex(str(material).replace(" ", ""))
        if len(root_key) != 16:
            session.state = "denied"
            session.reason = "bad_key_length"
            self.metrics["denies"] += 1
            return {"ok": False, "sid": sid, "reason": "bad_key_length"}

        # Session-Key aus dem mitgebrachten Material ableiten – identische Regel
        # wie im Token-Firmware-Modell, damit beide Seiten konvergieren.
        challenge = H.Challenge(
            token_id=token_id,
            value=secrets.token_bytes(16),
            iv=secrets.token_bytes(16),
            session_key=b"\x00" * 16,
        )
        challenge.session_key = H.derive_session_key(root_key, challenge.value, token_id)
        self.open_challenges[sid] = (session, challenge)
        session.state = "challenged"
        if self.cfg.verbose:
            self.session_material[sid] = root_key  # nur RAM, nie Disk
        self.audit("auth_challenge", {"sid": sid, "token_id": token_id, "ttl_s": round(challenge.expires - time.time(), 1)})
        return {
            "ok": True,
            "sid": sid,
            "mode": "gateway_crypto",
            "challenge": challenge.to_public_dict(),
            "gatt": {
                "write_char": CHAR_CHALLENGE_UUID,
                "notify_char": CHAR_RESPONSE_UUID,
            },
        }

    async def dispatch_challenge(self, sid: str) -> bool:
        """Challenge über dieBLE-Charakteristik zum Token bringen."""
        item = self.open_challenges.get(sid)
        if not item:
            return False
        _session, challenge = item
        if not self.ble:
            return False
        frame = challenge.value + challenge.iv
        ok = await self.ble.write_challenge(frame)
        self.metrics["ble_writes"] += 1
        if self.ble.status.get("backend") in (None, "mock"):
            ok = True
        self.ble.set_status(STATUS_WAITING)
        if ok:
            self.audit("ble_challenge_sent", {"sid": sid, "bytes": len(frame)})
        return bool(ok)

    def handle_response(self, payload: dict) -> dict:
        """RESPONSE (vom Token via Notify): Entschlüsselung + Validierung."""
        sid = str(payload.get("sid") or "")
        item = self.open_challenges.get(sid)
        if not item:
            self.metrics["denies"] += 1
            return {"ok": False, "reason": "unknown_or_expired_sid", "sid": sid}
        session, challenge = item
        if challenge.is_expired():
            self._close(sid, "denied", "challenge_expired")
            self.metrics["denies"] += 1
            return {"ok": False, "sid": sid, "reason": "challenge_expired"}

        session.attempts += 1
        try:
            ct = bytes.fromhex(str(payload.get("ciphertext") or ""))
            result = H.verify_response(challenge, ct, session.token_id)
        except Exception as exc:  # noqa: BLE001
            result = {"ok": False, "reason": f"parse_error: {exc}"}

        if not result["ok"]:
            # Brute-Force-Schutz wird TOKEN-bezogen gezählt (nicht pro Session):
            # ein Angreifer, der jede Leseaktion mit einer neuen Session tarnt,
            # landet trotzdem in der Sperre. Zähler verfällt nach lockout_seconds.
            rec = self.failures.get(session.token_id) or {"n": 0, "ts": time.time()}
            if time.time() - rec["ts"] > self.cfg.lockout_seconds:
                rec = {"n": 0, "ts": time.time()}
            rec["n"] += 1
            rec["ts"] = time.time()
            self.failures[session.token_id] = rec
            left = max(0, self.cfg.max_attempts - rec["n"])
            if rec["n"] >= self.cfg.max_attempts:
                self.locks[session.token_id] = time.time() + self.cfg.lockout_seconds
                self.failures.pop(session.token_id, None)
                self._close(sid, "locked", "too_many_failures")
                self.metrics["denies"] += 1
                self.audit("lockout", {"token_id": session.token_id, "for_s": self.cfg.lockout_seconds, "reason": result["reason"]})
                return {"ok": False, "sid": sid, "reason": "locked", "retry_in_s": self.cfg.lockout_seconds}
            self._close(sid, "denied", result["reason"])
            self.metrics["denies"] += 1
            self.audit("response_fail", {"sid": sid, "reason": result["reason"], "attempt": rec["n"], "uid": session.uid})
            return {"ok": False, "sid": sid, "reason": result["reason"], "attempts_left": left}

        entry = self.find_token(session.token_id) or {}
        if result.get("tamper"):
            entry["tamper_count"] = int(entry.get("tamper_count", 0)) + int(result["tamper"])
            self.metrics["tamper_events"] += int(result["tamper"])
            max_t = int(entry.get("max_tamper_count") or 0)
            if max_t and entry["tamper_count"] >= max_t:
                entry["revoked"] = True
                save_json(self.cfg.whitelist_file, self.whitelist)
                self._close(sid, "denied", "tamper_lockout")
                self.metrics["denies"] += 1
                if self.ble:
                    self.ble.set_status(STATUS_TAMPER)
                self.audit("tamper_lockout", {"token_id": session.token_id, "count": entry["tamper_count"]})
                return {"ok": False, "sid": sid, "reason": "tamper_lockout"}
            save_json(self.cfg.whitelist_file, self.whitelist)

        # Fingerabdruck bei Erfolg binden (falls Whitelist ohne Fingerabdruck startet)
        if entry is not None and not entry.get("key_fingerprint") and payload.get("key_fingerprint"):
            entry["key_fingerprint"] = payload["key_fingerprint"]
            save_json(self.cfg.whitelist_file, self.whitelist)

        self.failures.pop(session.token_id, None)
        session.battery_mv = result.get("battery_mv")
        session.tamper = result.get("tamper")
        self.metrics["grants"] += 1
        self._close(sid, "granted", "authenticated")
        if self.ble:
            self.ble.set_status(STATUS_SUCCESS)
        self.audit("granted", {"sid": sid, "token_id": session.token_id, "zone": session.zone, "battery_mv": session.battery_mv})
        return {
            "ok": True,
            "sid": sid,
            "token_id": session.token_id,
            "zone": session.zone,
            "battery_mv": session.battery_mv,
            "latency_ms": result.get("latency_ms"),
            "grant": {"relay": "open", "hold_s": 4, "log": True},
            "simulated": bool(self.cfg.mock),
        }

    def _close(self, sid: str, state: str, reason: str) -> None:
        item = self.open_challenges.pop(sid, None)
        session = item[0] if isinstance(item, tuple) else None
        if session is None:
            for s in reversed(self.sessions):
                if s.sid == sid:
                    session = s
                    break
        if session is not None:
            session.state = state
            session.reason = reason
            session.finished = time.time()
        self.session_material.pop(sid, None)
        self.save_snapshot()  # Phase 3: Verlauf sofort persistent (ohne Keys)
        if self.ble and state == "denied":
            self.ble.set_status(STATUS_FAIL)
        elif self.ble and state in ("granted", "locked"):
            self.ble.set_status(STATUS_TAMPER if state == "locked" else STATUS_SUCCESS)
        else:
            if self.ble:
                self.ble.set_status(STATUS_IDLE)

    # -- Simulator: Token, das den Gateway-Handshake durchspielt -----------
    def simulate_token_response(self, sid: str, root_key: bytes, battery_mv: int = 3250, tamper: int = 0) -> dict:
        item = self.open_challenges.get(sid)
        if not item:
            return {"ok": False, "reason": "no_open_challenge"}
        session, challenge = item
        ct = H.encrypt_response(root_key, challenge, session.token_id, battery_mv, tamper)
        self.metrics["ble_notify"] += 1
        return self.handle_response({"sid": sid, "ciphertext": ct.hex(), "key_fingerprint": H.token_key_fingerprint(root_key)})

    # -- Status ------------------------------------------------------------
    def agent_auth_summary(self) -> dict:
        """Zustand der Agent-Authentisierung (PSK-Fingerabdruck statt Geheimnis)."""
        mode = str(getattr(self.cfg, "require_agent_proof", "auto") or "auto").lower()
        try:
            secret = self.cfg.shared_secret()
        except Exception as exc:  # noqa: BLE001
            return {"mode": mode, "secret_present": False, "error": str(exc)}
        forced = mode in ("1", "true", "yes", "on")
        return {
            "mode": mode,
            "enforced": bool(secret) or forced,
            "secret_present": bool(secret),
            "fingerprint": H.token_key_fingerprint(secret)[:23] if secret else None,
            "bad_proofs": self.metrics.get("agent_proof_failures", 0),
            "suspended_agents": sorted(self.agent_failures),
        }

    def portview_block(self) -> dict:
        """Was PortView-Clients (App via nativer Bridge, Desktop) über diesen Host wissen müssen."""
        from discovery import PRODUCT, SERVICE, VERSION  # lokal: kein harter Pfad-Zwang beim Import

        cfg = self.cfg
        block: dict[str, Any] = {
            "product": PRODUCT,
            "service": SERVICE,
            "version": VERSION,
            "hostname": socket.gethostname(),
            "ports": {
                "http": int(cfg.http_port),
                "tcp": int(cfg.tcp_port),
                "bridge": int(getattr(cfg, "bridge_port", 8790)),
                "discovery": int(getattr(cfg, "discover_port", 18791)),
            },
            "udp_discovery": bool(getattr(cfg, "discover", False)),
            "ips": [],
        }
        try:
            infos = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
            block["ips"] = sorted({info[4][0] for info in infos})[:6]
        except OSError:
            pass
        if getattr(cfg, "http_host", None):
            block["bind"] = cfg.http_host
        responder = self.portview
        if responder is not None:
            block["discovery"] = responder.status()
        store = self.imports
        if store is not None:
            try:
                block["imports"] = store.stats()
            except Exception as exc:  # noqa: BLE001 - Status darf nicht am Katalog scheitern
                block["imports"] = {"error": str(exc)[:120]}
        return block

    def snapshot(self) -> dict:
        up = time.time() - self.started_at
        total = self.metrics["auth_requests"] or 1
        view = self.portview_block()
        return {
            "ok": True,
            "product": "DinGelSchwinG",
            "service": "dingelschwing-mobile-gateway",
            "ports": view["ports"],
            "portview": view,
            "uptime_s": round(up, 1),
            "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "config": {
                "tcp": f"{self.cfg.tcp_host}:{self.cfg.tcp_port}",
                "http": self.cfg.http_port,
                "mock": self.cfg.mock,
                "auto_enroll": bool(self.cfg.auto_enroll),
                "max_attempts": self.cfg.max_attempts,
                "lockout_seconds": self.cfg.lockout_seconds,
                "aes": "AES-128-CBC",
                "kdf": "HMAC-SHA256(CT45P-v1)",
            },
            "metrics": {**self.metrics, "success_rate": round(self.metrics["grants"] / total, 3)},
            "ble": self.ble.snapshot() if self.ble else None,
            "whitelist": {
                "count": len(self.whitelist.get("tokens", [])),
                "active": sum(1 for t in self.whitelist.get("tokens", []) if not t.get("revoked")),
                "locked": sum(1 for t in self.whitelist.get("tokens", []) if self.is_locked(t["token_id"])),
            },
            "agent_auth": self.agent_auth_summary(),
            "open_challenges": len([v for v in self.open_challenges.values() if v]),
            "simulated_token": bool(self.cfg.mock),
            "last_maintenance_error": self.last_maintenance_error or None,
            "connected_agents": len(self.clients),
            "recent_sessions": [s.to_dict() for s in list(self.sessions)[-12:]][::-1],
        }

    def metrics_text(self) -> str:
        up = time.time() - self.started_at
        lines = [
            "# HELP dingelschwing_gateway_uptime_seconds Laufzeit des mobilen BLE-Gateways",
            "# TYPE dingelschwing_gateway_uptime_seconds gauge",
            f"dingelschwing_gateway_uptime_seconds {up:.1f}",
        ]
        for key, value in self.metrics.items():
            name = f"dingelschwing_gateway_{key}"
            lines.append(f"# TYPE {name} counter" if key != "tokens_seen" else f"# TYPE {name} gauge")
            lines.append(f"{name} {value}")
        lines += [
            "# HELP dingelschwing_gateway_whitelist_size Größe der Token-Whitelist",
            "# TYPE dingelschwing_gateway_whitelist_size gauge",
            f"dingelschwing_gateway_whitelist_size {len(self.whitelist.get('tokens', []))}",
            "# HELP dingelschwing_gateway_open_challenges offene, noch nicht beantwortete Challenges",
            "# TYPE dingelschwing_gateway_open_challenges gauge",
            f"dingelschwing_gateway_open_challenges {len([v for v in self.open_challenges.values() if v])}",
            "# HELP dingelschwing_gateway_ble_advertising BLE-Werbung aktiv",
            "# TYPE dingelschwing_gateway_ble_advertising gauge",
            f"dingelschwing_gateway_ble_advertising {1 if self.ble and self.ble.status.get('advertising') else 0}",
        ]
        auth = self.agent_auth_summary()
        lines += [
            "# HELP dingelschwing_gateway_agent_proof_enforced 1 wenn agent_proof zwingend geprueft wird",
            "# TYPE dingelschwing_gateway_agent_proof_enforced gauge",
            f"dingelschwing_gateway_agent_proof_enforced {1 if auth.get('enforced') else 0}",
            "# HELP dingelschwing_gateway_suspended_agents suspendierte Agenten (zu viele Fehlversuche)",
            "# TYPE dingelschwing_gateway_suspended_agents gauge",
            f"dingelschwing_gateway_suspended_agents {len(auth.get('suspended_agents') or [])}",
        ]
        store = self.imports
        if store is not None:
            # Nur Katalog-Kennzahlen: die Zähler `imports`/`import_bytes`/`import_errors`
            # stammen aus state.metrics (Route) und würden sonst doppelt exponiert.
            try:
                stats = store.stats()
                lines += [
                    "# HELP dingelschwing_gateway_import_assets Anzahl Assets im Import-Katalog",
                    "# TYPE dingelschwing_gateway_import_assets gauge",
                    "dingelschwing_gateway_import_assets %d" % int(stats.get("count", 0)),
                    "# HELP dingelschwing_gateway_import_catalog_bytes Gesicherte Import-Bytes auf der Karte",
                    "# TYPE dingelschwing_gateway_import_catalog_bytes gauge",
                    "dingelschwing_gateway_import_catalog_bytes %d" % int(stats.get("bytes", 0)),
                    "# HELP dingelschwing_gateway_import_packs_total Importierte Pack-Manifeste",
                    "# TYPE dingelschwing_gateway_import_packs_total counter",
                    "dingelschwing_gateway_import_packs_total %d" % int(stats.get("packs", 0)),
                    "# HELP dingelschwing_gateway_import_dedupes_total Dedupe-Treffer (gleicher SHA-256)",
                    "# TYPE dingelschwing_gateway_import_dedupes_total counter",
                    "dingelschwing_gateway_import_dedupes_total %d" % int(stats.get("deduped", 0)),
                ]
            except Exception as exc:  # noqa: BLE001 - Metrics-Endpunkt bleibt lesbar
                lines.append("# import-metriken uebersprungen: %s" % str(exc)[:120].replace("\n", " "))
        responder = self.portview
        if responder is not None:
            lines += [
                "# HELP dingelschwing_gateway_portview_answers Antworten auf PortView-UDP-Broadcasts",
                "# TYPE dingelschwing_gateway_portview_answers counter",
                "dingelschwing_gateway_portview_answers %d" % int(responder.status().get("answers", 0)),
            ]
        return "\n".join(lines) + "\n"


def _seed(payload: dict) -> bytes:
    seed = payload.get("challenge_seed")
    if isinstance(seed, str) and len(seed) == 32:
        try:
            return bytes.fromhex(seed)
        except ValueError:
            pass
    return secrets.token_bytes(16)


def grant_from_command(state: GatewayState, payload: dict) -> dict:
    """Vom Agenten gemeldetes Ergebnis im `delegated`-Modus."""
    # `sid` case-insensitiv suchen: Chat-Eingaben werden lower()-geführt, die
    # Session-IDs des Gateways enthalten Großbuchstaben (S6AA…).
    sid = str(payload.get("sid") or "").strip()
    session = next(
        (x for x in reversed(state.sessions) if x.sid.lower() == sid.lower() and x.sid),
        None,
    )
    if not session:
        return {"ok": False, "reason": "unknown_sid", "sid": sid,
                "hint": "sid ist die Kennung aus der AUTH-Antwort (POST /nfc oder FRAME AUTH_ACK)"}
    sid = session.sid  # kanonische Schreibweise für Audit/Response
    if payload.get("granted"):
        state.metrics["grants"] += 1
        state._close(sid, "granted", str(payload.get("reason", "agent_granted")))
        state.audit("granted_delegated", {"sid": sid, "token_id": session.token_id, "reason": payload.get("reason")})
        return {"ok": True, "sid": sid, "state": "granted"}
    state.metrics["denies"] += 1
    state._close(sid, "denied", str(payload.get("reason", "agent_denied")))
    state.audit("denied_delegated", {"sid": sid, "reason": payload.get("reason")})
    return {"ok": True, "sid": sid, "state": "denied"}


async def handle_command(state: GatewayState, payload: dict) -> dict:
    """COMMAND-Verarbeitung (Agent → Gateway)."""
    action = str(payload.get("action") or "")
    if action == "whitelist_add":
        entry = state.add_token(
            str(payload["token_id"]), str(payload.get("label", "")), str(payload.get("zone", "default")),
            str(payload.get("key_fingerprint", "")),
        )
        state.audit("whitelist_add", {"token_id": entry["token_id"]})
        return {"ok": True, "token": entry}
    if action == "whitelist_revoke":
        ok = state.revoke_token(str(payload["token_id"]), bool(payload.get("revoked", True)))
        return {"ok": ok, "token_id": payload["token_id"]}
    if action == "unlock":
        state.locks.pop(str(payload.get("token_id")), None)
        state.audit("unlock", {"token_id": payload.get("token_id")})
        return {"ok": True}
    if action == "grant":
        return grant_from_command(state, payload)
    if action == "ble_scan":
        if not state.ble:
            return {"ok": False, "reason": "no_ble_adapter"}
        state.metrics["scans"] += 1
        devices = await state.ble.scan_once(int(payload.get("timeout", 4)))
        state.metrics["tokens_seen"] = max(state.metrics["tokens_seen"], len(devices))
        return {"ok": True, "devices": devices, "backend": state.ble.status.get("backend")}
    if action == "ble_advertise":
        if not state.ble:
            return {"ok": False, "reason": "no_ble_adapter"}
        await state.ble.start()
        state.audit("ble_advertise", {"backend": state.ble.status.get("backend")})
        return {"ok": True, "ble": state.ble.snapshot()}
    if action == "ble_stop":
        if state.ble:
            await state.ble.stop()
        return {"ok": True}
    if action == "demo_handshake":
        return await demo_handshake(state)
    if action == "selftest":
        return {"ok": True, "result": await asyncio.to_thread(run_loopback_test)}
    return {"ok": False, "reason": f"unbekannte action: {action!r}", "allowed": [
        "whitelist_add", "whitelist_revoke", "unlock", "grant", "ble_scan", "ble_advertise", "ble_stop", "demo_handshake", "selftest",
    ]}


def _proof_payload(state: GatewayState, token_id: str, agent_name: str) -> dict:
    """Bildet den `agent_proof`-Block, wie es ein korrekt konfigurierter Agent tut.

    Der Demo-Handshake läuft über denselben Nachweis-Pfad wie der echte Haupt-Agent –
    so prüft der Selbsttest die Agent-Authentisierung mit, statt sie zu umgehen.
    """
    try:
        secret = state.cfg.shared_secret()
    except Exception:  # noqa: BLE001
        secret = None
    if not secret:
        return {}
    nonce = secrets.token_bytes(16)
    ts = time.time()
    return {"nonce": nonce.hex(), "ts": ts, "mac": H.auth_prove_knowledge(secret, token_id, nonce, ts)}


async def demo_handshake(state: GatewayState) -> dict:
    """Vollständiger, kryptografisch echter Handshake ohne Hardware.

    Der „Token“ (Simulator) kennt den Root-Key; das Gateway sieht nur Challenge
    und verschlüsselte Antwort – genau die Vertrauensstellung des Feld-Setups.
    """
    root_key = bytes.fromhex("000102030405060708090a0b0c0d0e0f")
    token_id = "CT45P-DEMO"
    state.add_token(token_id, label="Demo-Token (Simulator)", zone="demo")
    auth = {"token_id": token_id, "uid": "04:A2:B3:C1", "session_material": root_key.hex()}
    proof = _proof_payload(state, token_id, "demo")
    if proof:
        auth["agent_proof"] = proof
    res = state.handle_auth(auth, agent_name="demo")
    if not res.get("ok"):
        return {"ok": False, "stage": "auth", "detail": res}
    sid = res["sid"]
    sent = await state.dispatch_challenge(sid)
    reply = state.simulate_token_response(sid, root_key, battery_mv=3310, tamper=0)
    return {
        "ok": bool(reply.get("ok")),
        "sid": sid,
        "challenge": res.get("challenge"),
        "ble_write_ok": sent,
        "verify": reply,
        # „Angriffsversuch“: gültiger Agent-Nachweis, aber fremder Root-Key ⇒
        # die Token-Seite fällt durch (key_mismatch/decryption_failed), nicht die Leitung.
        "simulated_wrong_key": state.handle_auth(
            {
                "token_id": token_id,
                "uid": "ff",
                "session_material": secrets.token_bytes(16).hex(),
                **({"agent_proof": p} if (p := _proof_payload(state, token_id, "attacker")) else {}),
            },
            agent_name="attacker",
        ),
    }


def run_loopback_test() -> dict:
    """Frame-Codec-Selbsttest (nutzt asyncio-loop extern)."""
    frames = [H.encode_frame(t, {"i": i, "text": "test-ärger"}) for i, t in enumerate([T_HELLO, T_AUTH, T_GRANT], start=1)]
    reader = H.FrameReader()
    out = reader.feed(b"".join(frames))
    assert len(out) == 3, f"erwartet 3 frames, bekam {len(out)}"
    assert [m for m, _ in out] == [T_HELLO, T_AUTH, T_GRANT]
    return {"ok": True, "frames": len(out), "names": [reader.describe(m) for m, _ in out]}


# Verwendete Typen für die Handler-Matrix (Import hier, damit das Modul
# eigenständig importierbar bleibt, ohne Zirkularitäten zu erzeugen).
__all__ = [
    "GatewayState",
    "Session",
    "handle_command",
    "demo_handshake",
    "run_loopback_test",
    "T_HELLO",
    "T_HELLO_ACK",
    "T_AUTH",
    "T_AUTH_ACK",
    "T_CHALLENGE",
    "T_DENY",
    "T_GRANT",
    "T_ERROR",
    "T_PING",
    "T_PONG",
    "T_STATUS",
    "T_STATUS_SNAP",
    "T_RESPONSE",
    "T_COMMAND",
]
