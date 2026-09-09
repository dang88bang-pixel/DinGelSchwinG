"""DinGelSchwinG · BLE-Adapterschicht des mobilen Gateways.

Drei Backends, absteigend nach Verfügbarkeit (auto-Modell):

  mock        – läuft ohne Hardware, simuliert Token-Verbindungen (Demo/Test)
  bluetoothctl– realer Scan über BlueZ (`bluetoothctl --timeout N scan on`)
  gdbus       – echte GATT-Peripheral-Registrierung über den BlueZ-1.0-GATT-API
                (`org.bluez.GattManager1.RegisterApplication`) –需要的 Root-Rechte.

Warum nicht `bleak`? bleak ist ein *Central*-Client (scan/connect/write) und kann
kein GATT-Peripheral sein. Für das „Gateway als Leser/Peripheral“-Szenario ist
der BlueZ-GATT-D-Bus-Pfad der korrekte Weg. `gdbus` ist auf RPi OS standardmäßig
vorhanden, deshalb nutzt dieses Modul den D-Bus ohne Python-Zusatzabhängigkeit.

⚠️ Die GATT-UUIDs/Charakteristiken stammen aus gw_config.HONEYWELL_* und sind
   ANNAHMEN (nicht von Honeywell dokumentiert). Vor dem Feldeinsatz mit einem
   echten CT45P Xon+ die Dienstliste auslesen und anpassen – siehe
   docs/mobile-ble-gateway.md „Schritt 1: Dienstrekonstruktion“.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from gw_config import (
    CHAR_CHALLENGE_UUID,
    CHAR_RESPONSE_UUID,
    CHAR_STATUS_UUID,
    HONEYWELL_DEVICE_NAME,
    HONEYWELL_SERVICE_UUID,
    STATUS_FAIL,
    STATUS_IDLE,
    STATUS_SUCCESS,
    STATUS_WAITING,
)

ScanCallback = Callable[[dict], Awaitable[None] | None]
ConnCallback = Callable[[str, bool], Awaitable[None] | None]


def _mac_from_text(text: str) -> list[tuple[str, str]]:
    found = re.findall(r"\sDevice\s+((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\s+(.*)", text)
    return [(mac.strip(), (name or "unbekannt").strip()) for mac, name in found]


@dataclass
class BleAdapter:
    """Abstraktion über dieBLE-Hardware. `backend` wird zur Laufzeit gewählt."""

    backend: str = "auto"          # auto | mock | bluetoothctl | gdbus
    mac: str = "C0:FF:EE:00:01:23"
    device_name: str = HONEYWELL_DEVICE_NAME
    adapter: str = "hci0"
    on_scan: ScanCallback | None = None
    on_connection: ConnCallback | None = None
    status: dict = field(default_factory=lambda: {"advertising": False, "connected": None, "backend": None})
    last_error: str = ""
    _proc: object | None = None
    _scan_task: asyncio.Task | None = None

    # -- Backend-Erkennung ------------------------------------------------
    async def resolve_backend(self) -> str:
        if self.backend != "auto":
            return self.backend
        if shutil.which("bluetoothctl"):
            return "bluetoothctl"
        return "mock"

    async def start(self) -> None:
        chosen = await self.resolve_backend()
        self.status["backend"] = chosen
        if chosen == "gdbus":
            await self._start_gdbus_peripheral()
        elif chosen == "bluetoothctl":
            await self._start_bluetoothctl()
        else:
            self.status["advertising"] = True
            print(f"[ble:mock] simuliere Werbung als {self.device_name} ({self.mac})")

    # -- bluetoothctl: Scan + Power ---------------------------------------
    async def _start_bluetoothctl(self) -> None:
        if not shutil.which("bluetoothctl"):
            self.last_error = "bluetoothctl nicht installiert"
            self.status["backend"] = "mock"
            self.status["advertising"] = True
            return
        try:
            proc = await asyncio.create_subprocess_exec(
                "bluetoothctl", "power", "on",
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=5)
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"bluetoothctl power on fehlgeschlagen: {exc}"
        self.status["advertising"] = True  # Scanner läuft, Werbung braucht gdbus
        self._scan_task = asyncio.create_task(self._scan_loop(interval=6.0))

    async def _scan_loop(self, interval: float) -> None:
        while True:
            try:
                devices = await self.scan_once(timeout=int(interval))
                for d in devices:
                    if self.on_scan:
                        res = self.on_scan(d)
                        if asyncio.iscoroutine(res):
                            await res
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)
            await asyncio.sleep(interval)

    async def scan_once(self, timeout: int = 4) -> list[dict]:
        backend = self.status.get("backend") or await self.resolve_backend()
        if backend == "bluetoothctl":
            cmd = ["bluetoothctl", "--timeout", str(timeout), "scan", "on"]
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                out, _ = await proc.communicate()
                text = out.decode("utf-8", "replace")
                pairs = _mac_from_text(text)
                rssi = [int(x) for x in re.findall(r"RSSI:\s*(-?\d+)", text)]
                return [
                    {
                        "id": mac,
                        "name": name,
                        "rssi": rssi[i] if i < len(rssi) else None,
                        "source": "bluetoothctl",
                        "seen_at": time.time(),
                    }
                    for i, (mac, name) in enumerate(pairs)
                ]
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"scan: {exc}"
                return []
        # mock: deterministische Demo-Umgebung
        return [
            {"id": self.mac, "name": self.device_name, "rssi": -57, "source": "mock", "seen_at": time.time()},
            {"id": "C0:FF:EE:00:09:99", "name": "CT45P-0002-DEMO", "rssi": -71, "source": "mock", "seen_at": time.time()},
        ]

    async def stop_scan(self) -> None:
        if self._scan_task:
            self._scan_task.cancel()
            self._scan_task = None

    # -- gdbus: echter GATT-Peripheral (BlueZ) ----------------------------
    async def _start_gdbus_peripheral(self) -> None:
        """Registriert Service + Charakteristiken über org.bluez.GattManager1.

        Erfordert: BlueZ ≥ 5.50 mit `--experimental`, Root, und dass der Adapter
        als Peripheral kann (nRF52840/BCM43430 ✅, viele Intel-Adapter ❌).
        """
        if not shutil.which("gdbus"):
            self.last_error = "gdbus fehlt – apt install libglib2.0-bin"
            return
        app = {
            "object_path": "/org/dgs/ct45p",
            "service_uuid": HONEYWELL_SERVICE_UUID,
            "service_primary": True,
            "characteristics": [
                {"uuid": CHAR_CHALLENGE_UUID, "flags": ["write", "write-without-response"], "acquire": True},
                {"uuid": CHAR_RESPONSE_UUID, "flags": ["notify"], "acquire": True},
                {"uuid": CHAR_STATUS_UUID, "flags": ["read", "notify"], "value": [STATUS_IDLE]},
            ],
        }
        try:
            await self._gdbus_call(
                "call", "org.bluez", self._adapter_path(), "org.bluez.GattManager1",
                "RegisterApplication", "oa{sv}", json.dumps([self._adapter_path(), app]),
            )
            await self._gdbus_call(
                "call", "org.bluez", self._adapter_path(), "org.bluez.Adapter1", "SetProperty", "sv",
                json.dumps(["Discoverable", {"type": "b", "value": True}]),
            )
            self.status["advertising"] = True
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"gdbus-Registration fehlgeschlagen: {exc}"

    def _adapter_path(self) -> str:
        return f"/org/bluez/{self.adapter}"

    async def _gdbus_call(self, *args: str) -> str:
        proc = await asyncio.create_subprocess_exec(
            "gdbus", *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode != 0:
            raise RuntimeError(err.decode("utf-8", "replace").strip() or f"exit {proc.returncode}")
        return out.decode("utf-8", "replace").strip()

    # -- Status-Charakteristik -------------------------------------------
    def set_status(self, value: int) -> None:
        self.status["last_status_byte"] = value
        if self.status.get("backend") == "gdbus":
            asyncio.create_task(self._notify_status(value))

    async def _notify_status(self, value: int) -> None:
        try:
            await self._gdbus_call(
                "call", "org.dgs.ct45p", f"{self._adapter_path()}/characteristic/{CHAR_STATUS_UUID.replace('-', '')}",
                "org.freedesktop.DBus.Properties", "Set", "ssv",
                json.dumps(["org.bluez.GattCharacteristic1", "Value", {"type": "ay", "value": [value]}]),
            )
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"notify: {exc}"

    async def write_challenge(self, payload: bytes) -> bool:
        """Schreibt die Challenge auf die Reader→Token-Charakteristik.

        mock-Backend: gibt True zurück, das simulierte Token antwortet selbst.
        """
        if self.status.get("backend") in (None, "mock"):
            return True
        if not shutil.which("bluetoothctl"):
            return False
        try:
            proc = await asyncio.create_subprocess_exec(
                "bluetoothctl", "--timeout", "5", "menu", "gatt",
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            cmd = f"write-value {CHAR_CHALLENGE_UUID} {payload.hex()}\n".encode()
            await asyncio.wait_for(proc.communicate(cmd), timeout=6)
            return proc.returncode == 0
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"write_challenge: {exc}"
            return False

    async def stop(self) -> None:
        await self.stop_scan()
        if self.status.get("backend") == "gdbus" and shutil.which("gdbus"):
            try:
                await self._gdbus_call(
                    "call", "org.bluez", self._adapter_path(), "org.bluez.GattManager1",
                    "UnregisterApplication", "o", json.dumps(["/org/dgs/ct45p"]),
                )
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)
        self.status["advertising"] = False
        self.status["connected"] = None

    def snapshot(self) -> dict:
        return {
            "backend": self.status.get("backend"),
            "advertising": self.status.get("advertising", False),
            "connected": self.status.get("connected"),
            "status_byte": self.status.get("last_status_byte", STATUS_IDLE),
            "status_name": {STATUS_IDLE: "idle", STATUS_WAITING: "waiting", STATUS_SUCCESS: "success", STATUS_FAIL: "fail"}.get(
                self.status.get("last_status_byte", STATUS_IDLE), "idle"
            ),
            "mac": self.mac,
            "device_name": self.device_name,
            "gatt": {
                "service": HONEYWELL_SERVICE_UUID,
                "challenge_char": CHAR_CHALLENGE_UUID,
                "response_char": CHAR_RESPONSE_UUID,
                "status_char": CHAR_STATUS_UUID,
                "note": "Annahme – vor Feldeinsatz mit nRF Connect/LightBlue gegen echten CT45P prüfen",
            },
            "last_error": self.last_error,
        }
