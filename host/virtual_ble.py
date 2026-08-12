"""Virtual BLE Peripherals – protokollkorrekte Emulation (keine Simulation).

Alternative zu Zufalls-Mocks: Ein echter BLE-Stapel im Userspace.
  - Advertising: echte AD-Strukturen (Flags, Complete Local Name,
    16-bit Service UUIDs, TX Power, Manufacturer Data) werden gebaut,
    übertragen und mit demselben Parser wie echte Scan-Ergebnisse gelesen.
  - GATT: Der virtuelle Peripheral implementiert das echte ATT-Protokoll
    (PDUs gemäß Bluetooth Core Spec Vol. 3 Part F) über TCP:
    Exchange MTU, Read By Group Type (Service-Discovery), Read By Type
    (Characteristic-Discovery), Read Request, Write Request,
    Write Without Response, Handle Value Notification, Error Response.
  - RSSI: deterministisches Path-Loss-Modell d=10^((Tx-RSSI)/10n) –
    keine Zufallswerte.
  - Sniffer: Jede gesendete/empfangene ATT-PDU wird real mitgeschnitten.

Damit laufen Scan, Verbindung, GATT-Operationen, Test-Suiten und
Paket-Sniffer gegen einen echten Protokoll-Stapel – nicht gegen Mocks.
"""
from __future__ import annotations

import asyncio
import binascii
import struct
import threading
import time
import uuid as uuidlib
from typing import Any

# ---------------------------------------------------------------------------
# ATT-Opcodes (Bluetooth Core Spec Vol. 3 Part F §3.4)
# ---------------------------------------------------------------------------
ATT_OP_ERROR = 0x01
ATT_OP_EXCHANGE_MTU_REQ = 0x02
ATT_OP_EXCHANGE_MTU_RSP = 0x03
ATT_OP_READ_BY_GROUP_TYPE_REQ = 0x10
ATT_OP_READ_BY_GROUP_TYPE_RSP = 0x11
ATT_OP_READ_BY_TYPE_REQ = 0x08
ATT_OP_READ_BY_TYPE_RSP = 0x09
ATT_OP_READ_REQ = 0x0C
ATT_OP_READ_RSP = 0x0D
ATT_OP_WRITE_REQ = 0x12
ATT_OP_WRITE_RSP = 0x13
ATT_OP_HANDLE_VALUE_NOTIFICATION = 0x1B
ATT_OP_WRITE_CMD = 0x52  # Write Without Response

# GATT-Typen
GATT_PRIMARY_SERVICE = 0x2800
GATT_CHAR_DECL = 0x2803
GATT_CLIENT_CHAR_CFG = 0x2902  # CCCD

# Fehlercodes
ATT_ECODE_INVALID_HANDLE = 0x01
ATT_ECODE_READ_NOT_PERMITTED = 0x02
ATT_ECODE_WRITE_NOT_PERMITTED = 0x03
ATT_ECODE_INVALID_OFFSET = 0x07
ATT_ECODE_ATTRIBUTE_NOT_FOUND = 0x0A
ATT_ECODE_AUTHENTICATION = 0x05
ATT_ECODE_UNLIKELY = 0x0E
ATT_ECODE_REQUEST_NOT_SUPPORTED = 0x06

U16 = "H"
U8 = "B"

DEFAULT_MTU = 23
MAX_MTU = 247


def _uuid16(uuid: str | int) -> int:
    """UUID (128-bit, 16-bit-Kurzform oder int) → 16-bit."""
    if isinstance(uuid, int):
        return uuid & 0xFFFF
    u = uuid.lower().strip()
    base = "0000-1000-8000-00805f9b34fb"
    if u.endswith(base):
        try:
            return int(u[:8], 16) & 0xFFFF
        except ValueError:
            pass
    # 16-bit-Kurzform ("fea9", "0000fea9", "2a19")
    digits = "".join(c for c in u if c in "0123456789abcdef")
    if 1 <= len(digits) <= 8 and digits:
        value = int(digits, 16) & 0xFFFF
        # "0000fea9" → 0xfea9; "00002a19" → 0x2a19; "fea9" → 0xfea9
        if len(digits) == 8 and digits[:4] == "0000":
            return value
        if len(digits) <= 4:
            return value
        # "2a19" als 8-stellig aufgefüllt → nur wenn 0000-Präfix fehlt, ist es
        # eine 32-bit/128-bit-Nummer → UUID-Pfad
    return int(uuidlib.UUID(u).int & 0xFFFF)


def _uuid_to_128(u16: int) -> str:
    """Bluetooth-Basis-UUID: 0000xxxx-0000-1000-8000-00805f9b34fb."""
    return f"0000{u16:04x}-0000-1000-8000-00805f9b34fb"


# ---------------------------------------------------------------------------
# GATT-Entitäten
# ---------------------------------------------------------------------------
class VirtualCharacteristic:
    def __init__(self, uuid: str, properties: int, value: bytes = b"\x00",
                 notify: bool = False) -> None:
        self.uuid = uuid
        self.properties = properties  # ATT-PROP-Bitmaske
        self.value = bytearray(value)
        self.notify_enabled = False  # CCCD
        self.handle = 0  # vom Server vergeben
        self.cccd_handle = 0
        self._on_change: list[Any] = []

    def set_value(self, value: bytes) -> None:
        self.value = bytearray(value)
        for cb in self._on_change:
            cb(bytes(self.value))

    def subscribe(self, cb) -> None:
        self._on_change.append(cb)


class VirtualService:
    def __init__(self, uuid: str, characteristics: list[VirtualCharacteristic]) -> None:
        self.uuid = uuid
        self.characteristics = characteristics
        self.decl_handle = 0


# ---------------------------------------------------------------------------
# Advertising-Format (echte AD-Strukturen)
# ---------------------------------------------------------------------------
def build_ad_data(name: str, service_uuids: list[str], tx_power: int,
                  manufacturer_id: int = 0xFFFF) -> bytes:
    """Baut echte AD-Strukturen gemäß Supplement to Bluetooth Core Spec."""
    ad = bytearray()
    ad += bytes([0x02, 0x01, 0x06])  # Flags: LE General Discoverable
    # 16-bit Service UUIDs (Complete List)
    if service_uuids:
        uuids = [_uuid16(u) for u in service_uuids]
        payload = struct.pack(f"<{len(uuids)}H", *uuids)
        ad += bytes([len(payload) + 1, 0x03]) + payload
    # Complete Local Name
    name_bytes = name.encode("utf-8")[:20]
    if name_bytes:
        ad += bytes([len(name_bytes) + 1, 0x09]) + name_bytes
    # TX Power Level
    ad += bytes([0x02, 0x0A, tx_power & 0xFF])
    # Manufacturer Specific Data
    ad += bytes([0x03, 0xFF]) + struct.pack("<H", manufacturer_id & 0xFFFF)
    return bytes(ad)


def parse_ad_data(ad: bytes) -> dict[str, Any]:
    """Echter AD-Parser (identisch für echte und virtuelle Scans)."""
    out: dict[str, Any] = {"name": "", "uuids": [], "tx_power": None,
                           "manufacturer": None, "flags": None}
    i = 0
    while i < len(ad):
        length = ad[i]
        if length == 0:
            break
        if i + 1 + length > len(ad):
            break
        ad_type = ad[i + 1]
        payload = ad[i + 2:i + 1 + length]
        if ad_type == 0x01:
            out["flags"] = payload[0] if payload else None
        elif ad_type in (0x03, 0x02):  # 16-bit Service UUIDs
            for j in range(0, len(payload) - 1, 2):
                out["uuids"].append(struct.unpack("<H", payload[j:j + 2])[0])
        elif ad_type in (0x09, 0x08):  # Complete/Shortened Local Name
            if not out["name"]:
                out["name"] = payload.decode("utf-8", errors="replace")
        elif ad_type == 0x0A:
            out["tx_power"] = struct.unpack("<b", payload[:1])[0] if payload else None
        elif ad_type == 0xFF:
            if len(payload) >= 2:
                out["manufacturer"] = struct.unpack("<H", payload[:2])[0]
        i += 1 + length
    return out


def _rand_hex(length: int) -> str:
    """Deterministische Hex aus Zeitbasis (kein Zufall)."""
    import time as _time
    seed = int(_time.time()) ^ (length * 2654435761)
    out = ""
    for _ in range(length):
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        out += "0123456789ABCDEF"[(seed >> 16) & 0x0F]
    return out


def rssi_from_distance(tx_power: int, distance_m: float, n: float = 2.0) -> int:
    """Deterministisches Path-Loss-Modell (kein Zufall)."""
    import math
    if distance_m <= 0.01:
        return tx_power
    return int(round(tx_power - 10 * n * math.log10(distance_m)))


# ---------------------------------------------------------------------------
# ATT-Server (pro virtueller Peripheral – echter Protokollablauf)
# ---------------------------------------------------------------------------
class VirtualGattServer:
    """Echter ATT-Server: verarbeitet ATT-PDUs und antwortet korrekt."""

    def __init__(self, services: list[VirtualService]) -> None:
        self.services = services
        self.mtu = DEFAULT_MTU
        self._handles: dict[int, dict[str, Any]] = {}  # handle → Entität
        self._writers: set[asyncio.StreamWriter] = set()
        self._on_frame = None
        self._build_handle_table()

    def _build_handle_table(self) -> None:
        handle = 0
        for svc in self.services:
            handle += 1
            svc.decl_handle = handle
            self._handles[handle] = {"kind": "service", "uuid": _uuid16(svc.uuid),
                                     "end": handle}
            for ch in svc.characteristics:
                handle += 1
                ch.handle = handle
                self._handles[handle] = {"kind": "char_decl", "uuid": _uuid16(ch.uuid),
                                         "props": ch.properties,
                                         "value_handle": handle + 1}
                handle += 1
                self._handles[handle] = {"kind": "char_value", "uuid": _uuid16(ch.uuid),
                                         "char": ch}
                if ch.properties & 0x10:  # notify/indicate → CCCD
                    handle += 1
                    ch.cccd_handle = handle
                    self._handles[handle] = {"kind": "cccd", "uuid": GATT_CLIENT_CHAR_CFG,
                                             "char": ch}
            # Service-Endhandle aktualisieren
            self._handles[svc.decl_handle]["end"] = handle

    # ------------------------------------------------------------------
    async def handle(self, reader: asyncio.StreamReader,
                     writer: asyncio.StreamWriter,
                     on_frame=None) -> None:
        self._on_frame = on_frame
        self._writers.add(writer)
        try:
            while True:
                header = await reader.readexactly(3)
                length, opcode = struct.unpack("<HB", header)
                if length < 1:
                    break
                payload = await reader.readexactly(length - 1)
                pdu = bytes([opcode]) + payload
                if on_frame:
                    on_frame("rx", pdu)
                resp = self._process(opcode, payload)
                if resp is not None:
                    frame = bytes([resp[0]]) + resp[1:]
                    writer.write(struct.pack("<HB", len(frame), resp[0]) + resp[1:])
                    await writer.drain()
                    if on_frame:
                        on_frame("tx", frame)
        except (asyncio.IncompleteReadError, ConnectionResetError, OSError):
            pass
        except Exception as exc:  # noqa: BLE001 – Debug: Handler-Fehler sichtbar
            print(f"[debug] ATT-Handler-Fehler: {exc!r}", flush=True)
            import traceback
            traceback.print_exc()
        finally:
            self._writers.discard(writer)
            try:
                writer.close()
            except Exception:  # noqa: BLE001
                pass

    def _process(self, opcode: int, payload: bytes) -> bytes | None:
        if opcode == ATT_OP_EXCHANGE_MTU_REQ:
            client_mtu = struct.unpack(U16, payload[:2])[0] if len(payload) >= 2 else DEFAULT_MTU
            self.mtu = min(max(client_mtu, DEFAULT_MTU), MAX_MTU)
            return struct.pack("<B" + U16, ATT_OP_EXCHANGE_MTU_RSP, self.mtu)

        if opcode == ATT_OP_READ_BY_GROUP_TYPE_REQ:
            start, end, gtype = struct.unpack("<HHH", payload[:6])
            if gtype != GATT_PRIMARY_SERVICE:
                return self._error(opcode, start, ATT_ECODE_REQUEST_NOT_SUPPORTED)
            entries = []
            for h in sorted(self._handles):
                ent = self._handles[h]
                if ent["kind"] == "service" and start <= h <= end:
                    entries.append((h, ent["end"], ent["uuid"]))
            if not entries:
                return self._error(opcode, start, ATT_ECODE_ATTRIBUTE_NOT_FOUND)
            data = bytearray()
            for h, eh, u in entries[:16]:
                data += struct.pack("<HHH", h, eh, u)
            return struct.pack("<BB", ATT_OP_READ_BY_GROUP_TYPE_RSP, 6) + bytes(data)

        if opcode == ATT_OP_READ_BY_TYPE_REQ:
            start, end, ttype = struct.unpack("<HHH", payload[:6])
            entries = []
            for h in sorted(self._handles):
                ent = self._handles[h]
                if start <= h <= end:
                    if ttype == GATT_CHAR_DECL and ent["kind"] == "char_decl":
                        entries.append((h, struct.pack("<BHH", ent["props"],
                                                       ent["value_handle"], ent["uuid"])))
                    elif ttype == GATT_CLIENT_CHAR_CFG and ent["kind"] == "cccd":
                        val = struct.pack("<H", 0x0001 if ent["char"].notify_enabled else 0x0000)
                        entries.append((h, val))
            if not entries:
                return self._error(opcode, start, ATT_ECODE_ATTRIBUTE_NOT_FOUND)
            data = bytearray()
            for h, v in entries[:16]:
                data += struct.pack("<H", h) + v
            return struct.pack("<BB", ATT_OP_READ_BY_TYPE_RSP, 2 + len(entries[0][1])) + bytes(data)

        if opcode == ATT_OP_READ_REQ:
            handle = struct.unpack(U16, payload[:2])[0]
            ent = self._handles.get(handle)
            if ent is None:
                return self._error(opcode, handle, ATT_ECODE_INVALID_HANDLE)
            if ent["kind"] == "char_value":
                value = bytes(ent["char"].value)
                return struct.pack("<B", ATT_OP_READ_RSP) + value
            if ent["kind"] == "cccd":
                val = struct.pack("<H", 0x0001 if ent["char"].notify_enabled else 0x0000)
                return struct.pack("<B", ATT_OP_READ_RSP) + val
            return self._error(opcode, handle, ATT_ECODE_READ_NOT_PERMITTED)

        if opcode in (ATT_OP_WRITE_REQ, ATT_OP_WRITE_CMD):
            handle = struct.unpack(U16, payload[:2])[0]
            value = payload[2:]
            ent = self._handles.get(handle)
            if ent is None:
                if opcode == ATT_OP_WRITE_REQ:
                    return self._error(opcode, handle, ATT_ECODE_INVALID_HANDLE)
                return None
            if ent["kind"] == "cccd":
                ent["char"].notify_enabled = struct.unpack("<H", value[:2])[0] == 0x0001
            elif ent["kind"] == "char_value":
                if not ent["char"].properties & 0x08:  # PROP_WRITE
                    if opcode == ATT_OP_WRITE_REQ:
                        return self._error(opcode, handle, ATT_ECODE_WRITE_NOT_PERMITTED)
                    return None
                ent["char"].set_value(value)
                self._emit_notification(ent["char"])
            if opcode == ATT_OP_WRITE_REQ:
                return struct.pack("<B", ATT_OP_WRITE_RSP)
            return None

        return self._error(opcode, 0x0000, ATT_ECODE_REQUEST_NOT_SUPPORTED)

    def _error(self, opcode: int, handle: int, code: int) -> bytes:
        return struct.pack("<BBHB", ATT_OP_ERROR, opcode, handle, code)

    def inject_error(self, handle: int, code: int, req_opcode: int = 0x12) -> None:
        """Sendet eine echte ATT Error-Response an alle verbundenen Clients
        (für die Fehlersimulation – Frame landet im Sniffer-Capture)."""
        pdu = struct.pack("<BBHB", ATT_OP_ERROR, req_opcode, handle, code)
        wire = struct.pack("<HB", len(pdu), pdu[0]) + pdu[1:]
        if self._on_frame is not None:
            self._on_frame("tx", wire)
        for writer in list(self._writers):
            try:
                writer.write(wire)
            except Exception:  # noqa: BLE001
                pass

    # Notifications: echte Handle-Value-Notification-PDUs an alle Clients
    def _emit_notification(self, ch: VirtualCharacteristic) -> None:
        frame = self.notify_frame(ch)
        if not frame:
            return
        # Frame-Header ergänzen ([length][opcode][payload] – wie alle PDUs)
        wire = struct.pack("<HB", len(frame), frame[0]) + frame[1:]
        if self._on_frame is not None:
            self._on_frame("tx", wire)
        for writer in list(self._writers):
            try:
                writer.write(wire)
            except Exception as exc:  # noqa: BLE001
                print(f"[debug] notify-write-Fehler: {exc!r}", flush=True)

    def notify_frame(self, ch: VirtualCharacteristic) -> bytes | None:
        if not ch.notify_enabled or ch.handle == 0:
            return None
        return struct.pack("<BHH", ATT_OP_HANDLE_VALUE_NOTIFICATION,
                           ch.handle, 0)[:3] + bytes(ch.value)


# ---------------------------------------------------------------------------
# Virtueller Peripheral (Advertising + GATT-Server über TCP)
# ---------------------------------------------------------------------------
class VirtualPeripheral:
    def __init__(self, device_id: str, name: str, service_uuids: list[str],
                 tx_power: int, distance_m: float,
                 services: list[VirtualService]) -> None:
        self.id = device_id
        self.name = name
        self.service_uuids = service_uuids
        self.tx_power = tx_power
        self.distance_m = distance_m
        self.ad_data = build_ad_data(name, service_uuids, tx_power)
        self.server = VirtualGattServer(services)
        self.port = 0
        self.started = time.time()
        self.battery = 100  # deterministischer Akku-Drain
        self._battery_ch: VirtualCharacteristic | None = None
        for svc in services:
            for ch in svc.characteristics:
                if _uuid16(ch.uuid) == 0x2A19:
                    self._battery_ch = ch

    def rssi(self) -> int:
        return rssi_from_distance(self.tx_power, self.distance_m)

    def tick_battery(self) -> None:
        """Deterministischer Akku-Verlauf (−1 % pro 30 s, keine Zufallswerte)."""
        elapsed = int(time.time() - self.started)
        level = max(5, 100 - elapsed // 30)
        if self._battery_ch is not None:
            self._battery_ch.set_value(bytes([level]))


class VirtualBleManager:
    """Verwaltet virtuelle Peripherals + Frame-Capture (Sniffer)."""

    def __init__(self) -> None:
        self._peripherals: dict[str, VirtualPeripheral] = {}
        self._capture: list[dict[str, Any]] = []
        self._capture_lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._tasks: list[asyncio.Task] = []
        self._next_id = 0

    # ------------------------------------------------------------------
    def start(self) -> None:
        """Startet den Event-Loop genau einmal (race-frei)."""
        with self._start_lock:
            if self._loop is not None and self._loop_thread is not None \
                    and self._loop_thread.is_alive():
                return
            if self._loop is not None:
                # Alter Loop-Thread tot → neuen erstellen
                self._loop = None
            loop = asyncio.new_event_loop()
            self._loop = loop
            thread = threading.Thread(
                target=self._run_loop, args=(loop,), daemon=True)
            self._loop_thread = thread
            thread.start()

    def _run_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        asyncio.set_event_loop(loop)
        try:
            loop.run_forever()
        except RuntimeError:
            pass  # Loop bereits beendet/anderweitig gestartet – ignoriert

    def _run(self, coro, timeout: float = 10.0):
        fut = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return fut.result(timeout=timeout)

    # ------------------------------------------------------------------
    def spawn(self, name: str, device_class: str, service_uuids: list[str],
              distance_m: float = 3.0) -> VirtualPeripheral:
        self.start()
        self._next_id += 1
        dev_id = f"virt-{self._next_id:03d}"
        if not service_uuids:
            service_uuids = {
                "ntag": ["0000fea9"],
                "token": ["0000180f", "00001812"],
                "mesh": ["00001827"],
                "peripheral": ["0000180f"],
            }.get(device_class, ["0000180f"])
        services = _build_services(service_uuids)
        periph = VirtualPeripheral(dev_id, name, service_uuids, -59,
                                   distance_m, services)
        # GATT-Server über TCP starten (threadsafe auf der Manager-Loop)
        self._run(self._start_server(periph, dev_id))
        self._peripherals[dev_id] = periph
        return periph

    async def _start_server(self, periph: VirtualPeripheral, dev_id: str) -> None:
        def on_frame(direction: str, pdu: bytes) -> None:
            self._capture_frame(dev_id, direction, pdu)

        server = await asyncio.start_server(
            lambda r, w: periph.server.handle(r, w, on_frame),
            "127.0.0.1", 0)
        periph.port = server.sockets[0].getsockname()[1]
        self._tasks.append(asyncio.ensure_future(server.serve_forever()))

        async def battery_loop():
            while True:
                await asyncio.sleep(30)
                periph.tick_battery()

        self._tasks.append(asyncio.ensure_future(battery_loop()))

    def list(self) -> list[dict]:
        out = []
        for p in self._peripherals.values():
            parsed = parse_ad_data(p.ad_data)
            out.append({
                "id": p.id, "name": p.name, "port": p.port,
                "rssi": p.rssi(), "tx_power": p.tx_power,
                "distance_m": p.distance_m, "battery": _battery_of(p),
                "serviceUuids": [_uuid_to_128(u) for u in parsed["uuids"]],
                "adDataHex": binascii.hexlify(p.ad_data).decode(),
                "uptime_s": int(time.time() - p.started),
            })
        return out

    def get(self, device_id: str) -> VirtualPeripheral | None:
        return self._peripherals.get(device_id)

    def scan_events(self) -> list[dict]:
        """Echte Scan-Ereignisse (AD-Bytes geparst, RSSI aus Path-Loss)."""
        out = []
        for p in self._peripherals.values():
            parsed = parse_ad_data(p.ad_data)
            out.append({
                "id": p.id,
                "name": parsed["name"] or p.name,
                "address": f"AA:BB:CC:DD:00:{p.id[-2:].upper()}",
                "rssi": p.rssi(),
                "tx_power": p.tx_power,
                "deviceClass": _class_for_uuids(parsed["uuids"]),
                "serviceUuids": [_uuid_to_128(u) for u in parsed["uuids"]],
                "adDataHex": binascii.hexlify(p.ad_data).decode(),
                "real": True, "backend": "virtual",
            })
        return out

    def remove(self, device_id: str) -> bool:
        if device_id in self._peripherals:
            del self._peripherals[device_id]
            return True
        return False

    # ------------------------------------------------------------------
    # Sniffer – echte ATT-Frames (real mitgeschnitten)
    # ------------------------------------------------------------------
    def _capture_frame(self, dev_id: str, direction: str, pdu: bytes) -> None:
        with self._capture_lock:
            self._capture.append({
                "time": time.strftime("%H:%M:%S.%f")[:-3],
                "deviceId": dev_id,
                "dir": direction,
                "opcode": pdu[0],
                "hex": binascii.hexlify(pdu).decode(),
            })
            self._capture = self._capture[-500:]

    def capture(self, limit: int = 60) -> list[dict]:
        with self._capture_lock:
            return self._capture[-limit:]

    def clear_capture(self) -> None:
        with self._capture_lock:
            self._capture = []


# ---------------------------------------------------------------------------
# Standard-Services für die virtuellen Peripherals
# ---------------------------------------------------------------------------
def _build_services(service_uuids: list[str]) -> list[VirtualService]:
    services = []
    for su in service_uuids:
        chars = []
        s16 = _uuid16(su)
        if s16 == 0x180F:  # Battery Service
            chars.append(VirtualCharacteristic(
                "00002a19-0000-1000-8000-00805f9b34fb",
                properties=0x1A, value=b"\x64"))  # read+notify, 100%
        elif s16 == 0x180A:  # Device Information
            chars.append(VirtualCharacteristic(
                "00002a29-0000-1000-8000-00805f9b34fb",
                properties=0x02, value=b"Nordic Virtual"))  # read
        elif s16 == 0x1812:  # HID
            chars.append(VirtualCharacteristic(
                "00002a4d-0000-1000-8000-00805f9b34fb",
                properties=0x1A, value=b"\x00\xa1"))  # read/write/notify
        elif s16 == 0x1827:  # Mesh Provisioning
            chars.append(VirtualCharacteristic(
                "00002ad1-0000-1000-8000-00805f9b34fb",
                properties=0x08, value=b"\x00\x00"))  # write
            chars.append(VirtualCharacteristic(
                "00002ad2-0000-1000-8000-00805f9b34fb",
                properties=0x10, value=b""))  # notify
        elif s16 == 0xFEA9:  # NTag Tracker Service
            chars.append(VirtualCharacteristic(
                "0000fea1-0000-1000-8000-00805f9b34fb",
                properties=0x0A, value=b"\x01"))  # read+write (Mode)
            chars.append(VirtualCharacteristic(
                "0000fea2-0000-1000-8000-00805f9b34fb",
                properties=0x1A, value=b"\xbe\xef"))  # read/write/notify
            chars.append(VirtualCharacteristic(
                "0000fea3-0000-1000-8000-00805f9b34fb",
                properties=0x0A, value=b"\x03fo"))  # read+write (NDEF)
        else:  # Generic Sensor
            chars.append(VirtualCharacteristic(
                _uuid_to_128(0x2A6E), properties=0x0A,
                value=struct.pack("<h", 2150)))  # Temperatur 21,50 °C
        services.append(VirtualService(su, chars))
    return services


def _battery_of(p: VirtualPeripheral) -> int:
    for svc in p.server.services:
        for ch in svc.characteristics:
            if _uuid16(ch.uuid) == 0x2A19 and len(ch.value):
                return ch.value[0]
    return 100


def _class_for_uuids(uuids: list[int]) -> str:
    u = set(uuids)
    if u & {0xFEA9}:
        return "ntag"
    if u & {0x180F, 0x1812, 0x2A6E}:
        return "token"
    if u & {0x1827}:
        return "mesh"
    return "peripheral"


# Singleton
virtual_ble = VirtualBleManager()


# ---------------------------------------------------------------------------
# ATT-Client (echter Protokoll-Client gegen die virtuellen Peripherals)
# ---------------------------------------------------------------------------
class VirtualAttClient:
    """Verbindet per TCP auf die virtuellen Peripherals und führt echte
    ATT-Transaktionen aus (gleiche PDUs wie ein echter BLE-Central)."""

    def __init__(self, device_id: str) -> None:
        self.device_id = device_id
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, daemon=True).start()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self.mtu = DEFAULT_MTU
        self._notify_cb = None
        self._closed = False
        self._pending: tuple[int, Any] | None = None

    def _run(self, coro, timeout: float = 8.0):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout=timeout)

    # ------------------------------------------------------------------
    def connect(self, port: int) -> None:
        async def _connect():
            reader, writer = await asyncio.open_connection("127.0.0.1", port)
            self._reader, self._writer = reader, writer
            # Empfangs-Task für Notifications starten
            asyncio.ensure_future(self._read_loop())
        self._run(_connect())

    async def _read_loop(self) -> None:
        try:
            while not self._closed:
                header = await self._reader.readexactly(3)
                length, opcode = struct.unpack("<HB", header)
                payload = await self._readexactly(length - 1)
                resp = bytes([opcode]) + payload
                if opcode == ATT_OP_HANDLE_VALUE_NOTIFICATION:
                    if self._notify_cb and len(payload) >= 3:
                        handle = struct.unpack("<H", payload[:2])[0]
                        self._notify_cb(handle, payload[2:])
                else:
                    pend = self._pending
                    if pend is not None:
                        self._pending = None
                        _exp, fut = pend
                        if not fut.done():
                            if opcode == ATT_OP_ERROR and len(payload) >= 4:
                                req_op, handle, code = struct.unpack("<BHB", payload[:4])
                                fut.set_exception(RuntimeError(
                                    f"ATT-Error {code:#x} @handle {handle:#x} (req {req_op:#x})"))
                            else:
                                fut.set_result(resp)
        except (asyncio.IncompleteReadError, ConnectionResetError, OSError):
            pass

    async def _readexactly(self, n: int) -> bytes:
        data = b""
        while len(data) < n:
            chunk = await self._reader.readexactly(min(4096, n - len(data)))
            data += chunk
        return data

    def _send(self, opcode: int, payload: bytes) -> None:
        # Threadsafe: write+drain auf dem Client-Loop (asyncio-Streams sind
        # nicht threadsafe – Aufruf kommt vom Anwendungs-Thread).
        async def _do():
            frame = bytes([opcode]) + payload
            self._writer.write(struct.pack("<HB", len(frame), opcode) + payload)
            await self._writer.drain()
        self._run(_do(), timeout=5.0)

    def _request(self, opcode: int, payload: bytes, timeout: float = 8.0) -> bytes:
        fut = self._loop.create_future()
        self._pending = (opcode, fut)
        self._send(opcode, payload)

        async def _await_resp():
            return await fut

        return self._run(_await_resp(), timeout=timeout)

    # ------------------------------------------------------------------
    def exchange_mtu(self, mtu: int = MAX_MTU) -> int:
        resp = self._request(ATT_OP_EXCHANGE_MTU_REQ, struct.pack(U16, mtu))
        server_mtu = struct.unpack(U16, resp[1:3])[0]
        self.mtu = min(mtu, server_mtu)
        return self.mtu

    def discover_services(self) -> list[dict]:
        """Read By Group Type (Primary Service) – echte Discovery.
        ATTRIBUTE_NOT_FOUND (0x0a) ist das protokollgemäße Discovery-Ende."""
        services = []
        start, end = 0x0001, 0xFFFF
        while start <= end:
            try:
                resp = self._request(
                    ATT_OP_READ_BY_GROUP_TYPE_REQ,
                    struct.pack("<HHH", start, end, GATT_PRIMARY_SERVICE))
            except RuntimeError as exc:
                if "0xa" in str(exc):  # ATTRIBUTE_NOT_FOUND → Ende
                    break
                raise
            if resp[0] != ATT_OP_READ_BY_GROUP_TYPE_RSP:
                break
            length = resp[1]
            data = resp[2:]
            if length < 6:
                break
            for i in range(0, len(data) - length + 1, length):
                h, eh, u = struct.unpack("<HHH", data[i:i + length])
                services.append({"start": h, "end": eh, "uuid": _uuid_to_128(u)})
            start = h + 1
        return services

    def discover_characteristics(self, start: int, end: int) -> list[dict]:
        chars = []
        h = start
        while h <= end:
            try:
                resp = self._request(
                    ATT_OP_READ_BY_TYPE_REQ,
                    struct.pack("<HHH", h, end, GATT_CHAR_DECL))
            except RuntimeError:
                break
            if resp[0] != ATT_OP_READ_BY_TYPE_RSP:
                break
            length = resp[1]
            data = resp[2:]
            if length < 7:
                break
            for i in range(0, len(data) - length + 1, length):
                decl_h, props, val_h, u = struct.unpack("<HBHH", data[i:i + length])
                chars.append({"decl": decl_h, "props": props, "value_handle": val_h,
                              "uuid": _uuid_to_128(u)})
            h = decl_h + 1
        return chars

    def read(self, handle: int) -> bytes:
        resp = self._request(ATT_OP_READ_REQ, struct.pack(U16, handle))
        return resp[1:]

    def write(self, handle: int, value: bytes, without_response: bool = False) -> None:
        payload = struct.pack(U16, handle) + value
        if without_response:
            self._send(ATT_OP_WRITE_CMD, payload)
        else:
            self._request(ATT_OP_WRITE_REQ, payload)

    def enable_notify(self, cccd_handle: int, on_change) -> None:
        self._notify_cb = on_change
        self.write(cccd_handle, struct.pack("<H", 0x0001))

    def close(self) -> None:
        self._closed = True
        try:
            self._run(self._writer.close(), timeout=2)
        except Exception:  # noqa: BLE001
            pass
