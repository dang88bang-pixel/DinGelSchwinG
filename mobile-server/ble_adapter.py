"""DinGelSchwinG · BLE-Adapterschicht des mobilen Gateways.

`bluetoothctl` is used only for a verifiable BlueZ central scan.  A shell call
cannot host the persistent D-Bus object tree that BlueZ requires for a GATT
peripheral.  Therefore the historical ``gdbus`` option fails closed: it never
reports advertising or GATT registration until a real persistent D-Bus runtime
and the CT45P service contract are installed.

The explicit ``mock`` backend remains useful to gateway protocol tests. Its
returned rows are marked as simulated; callers must not present them as radio
observations.
"""
from __future__ import annotations

import asyncio
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

# REAL-IMPLEMENTATION 2026-09-11
ScanCallback = Callable[[dict], Awaitable[None] | None]
ConnCallback = Callable[[str, bool], Awaitable[None] | None]

_MAC = r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"
_DEVICE_LINE = re.compile(rf"(?:\[[^]]+\]\s*)?Device\s+({_MAC})(?:\s+(.*))?", re.IGNORECASE)
_RSSI_LINE = re.compile(rf"(?:\[[^]]+\]\s*)?Device\s+({_MAC})\s+RSSI:\s*(-?\d+)", re.IGNORECASE)


def _parse_bluetoothctl_scan(text: str, seen_at: float) -> list[dict]:
    """Parse BlueZ's evolving human output while retaining RSSI/MAC relation."""
    devices: dict[str, dict] = {}
    for line in text.splitlines():
        rssi_match = _RSSI_LINE.search(line)
        if rssi_match:
            mac = rssi_match.group(1).upper()
            devices.setdefault(mac, {"id": mac, "name": mac})["rssi"] = int(rssi_match.group(2))
            continue
        device_match = _DEVICE_LINE.search(line)
        if not device_match:
            continue
        mac = device_match.group(1).upper()
        detail = (device_match.group(2) or "").strip()
        # Property updates such as "Connected: yes" must not replace a name.
        if detail and not re.match(r"(?:RSSI|Connected|Paired|Trusted|UUIDs):", detail, re.IGNORECASE):
            devices.setdefault(mac, {"id": mac, "name": mac})["name"] = detail
        else:
            devices.setdefault(mac, {"id": mac, "name": mac})
    return [
        {**device, "source": "bluetoothctl", "simulated": False, "seen_at": seen_at}
        for device in devices.values()
    ]


@dataclass
class BleAdapter:
    """BLE central scanner with an honest fail-closed peripheral capability."""

    backend: str = "auto"  # auto | mock | bluetoothctl | gdbus (fail closed)
    mac: str = "C0:FF:EE:00:01:23"
    device_name: str = HONEYWELL_DEVICE_NAME
    adapter: str = "hci0"
    on_scan: ScanCallback | None = None
    on_connection: ConnCallback | None = None
    status: dict = field(default_factory=lambda: {
        "advertising": False,
        "connected": None,
        "backend": None,
        "scanning": False,
        "gatt_registered": False,
    })
    last_error: str = ""
    _scan_task: asyncio.Task | None = None

    async def resolve_backend(self) -> str:
        if self.backend != "auto":
            return self.backend
        return "bluetoothctl" if shutil.which("bluetoothctl") else "mock"

    async def start(self) -> None:
        """Initialise the selected backend without claiming unverified GATT state."""
        chosen = await self.resolve_backend()
        self.status["backend"] = chosen
        self.status["advertising"] = False
        self.status["gatt_registered"] = False
        if chosen == "bluetoothctl":
            await self._start_bluetoothctl()
        elif chosen == "gdbus":
            await self._start_gdbus_peripheral()
        elif chosen == "mock":
            self.status["emulated"] = True
            self.last_error = "mock backend: no physical BLE adapter is active"
        else:
            self.last_error = f"unknown BLE backend: {chosen}"

    async def _start_bluetoothctl(self) -> None:
        if not shutil.which("bluetoothctl"):
            self.last_error = "bluetoothctl is not installed"
            self.status["scanning"] = False
            return
        try:
            code, _, stderr = await self._run("bluetoothctl", "power", "on", timeout=5)
            if code != 0:
                self.last_error = f"bluetoothctl power on failed: {stderr or f'exit {code}'}"
                return
            self.status["scanning"] = True
            self._scan_task = asyncio.create_task(self._scan_loop(interval=6.0))
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"bluetoothctl power on failed: {exc}"
            self.status["scanning"] = False

    async def _start_gdbus_peripheral(self) -> None:
        """Fail closed rather than masquerading a one-shot CLI call as GATT hosting."""
        self.status["advertising"] = False
        self.status["gatt_registered"] = False
        self.last_error = (
            "GATT peripheral unavailable: gdbus CLI cannot export the persistent "
            "ObjectManager/service/characteristic objects BlueZ RegisterApplication requires. "
            "Install a persistent D-Bus runtime (for example dbus-next or PyGObject), "
            "enable bluetoothd --experimental, and provide the validated CT45P GATT contract."
        )

    async def _run(self, *command: str, timeout: float) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError(f"{' '.join(command[:2])} timed out after {timeout:g}s")
        return (
            int(proc.returncode or 0),
            out.decode("utf-8", "replace"),
            err.decode("utf-8", "replace").strip(),
        )

    async def _scan_loop(self, interval: float) -> None:
        while True:
            try:
                for device in await self.scan_once(timeout=max(1, int(interval))):
                    if self.on_scan is None:
                        continue
                    result = self.on_scan(device)
                    if asyncio.iscoroutine(result):
                        await result
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"background scan: {exc}"
            await asyncio.sleep(interval)

    async def scan_once(self, timeout: int = 4) -> list[dict]:
        """Scan actual nearby BLE devices, or explicit clearly-labelled test data."""
        timeout = max(1, min(int(timeout), 30))
        backend = self.status.get("backend") or await self.resolve_backend()
        if backend == "bluetoothctl":
            if not shutil.which("bluetoothctl"):
                self.last_error = "bluetoothctl is not installed"
                return []
            try:
                code, stdout, stderr = await self._run(
                    "bluetoothctl", "--timeout", str(timeout), "scan", "on", timeout=timeout + 3,
                )
                if code != 0:
                    self.last_error = f"bluetoothctl scan failed: {stderr or f'exit {code}'}"
                    return []
                self.status["scanning"] = True
                return _parse_bluetoothctl_scan(stdout, time.time())
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"scan failed: {exc}"
                return []
        if backend == "mock":
            # Test-only fixture. The HTTP/UI layer explicitly rejects backend=mock.
            now = time.time()
            return [
                {"id": self.mac, "name": self.device_name, "rssi": -57, "source": "mock", "simulated": True, "seen_at": now},
                {"id": "C0:FF:EE:00:09:99", "name": "CT45P-0002-DEMO", "rssi": -71, "source": "mock", "simulated": True, "seen_at": now},
            ]
        self.last_error = self.last_error or "BLE scan unavailable for GATT peripheral backend"
        return []

    async def stop_scan(self) -> None:
        task = self._scan_task
        self._scan_task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.status["scanning"] = False

    def set_status(self, value: int) -> None:
        """Record protocol state; notify only once a real GATT server exists."""
        self.status["last_status_byte"] = value
        if self.status.get("gatt_registered"):
            self.last_error = "GATT status notification is not implemented by an unregistered peripheral"

    async def write_challenge(self, payload: bytes) -> bool:
        """Write support needs a connected selected GATT peer; fail safely otherwise."""
        if not payload:
            self.last_error = "challenge payload is empty"
            return False
        if self.status.get("backend") == "mock":
            # Explicit test backend only; it does not indicate RF delivery.
            return True
        self.last_error = (
            "cannot write BLE challenge: no verified connected GATT client/session. "
            "A validated central transport and CT45P characteristic contract are required."
        )
        return False

    async def stop(self) -> None:
        await self.stop_scan()
        self.status["advertising"] = False
        self.status["gatt_registered"] = False
        self.status["connected"] = None

    def snapshot(self) -> dict:
        return {
            "backend": self.status.get("backend"),
            "advertising": bool(self.status.get("advertising")),
            "scanning": bool(self.status.get("scanning")),
            "gatt_registered": bool(self.status.get("gatt_registered")),
            "emulated": bool(self.status.get("emulated")),
            "connected": self.status.get("connected"),
            "status_byte": self.status.get("last_status_byte", STATUS_IDLE),
            "status_name": {
                STATUS_IDLE: "idle", STATUS_WAITING: "waiting", STATUS_SUCCESS: "success", STATUS_FAIL: "fail",
            }.get(self.status.get("last_status_byte", STATUS_IDLE), "idle"),
            "mac": self.mac,
            "device_name": self.device_name,
            "gatt": {
                "service": HONEYWELL_SERVICE_UUID,
                "challenge_char": CHAR_CHALLENGE_UUID,
                "response_char": CHAR_RESPONSE_UUID,
                "status_char": CHAR_STATUS_UUID,
                "available": False,
                "note": "CT45P UUIDs remain unvalidated assumptions; no GATT service is advertised by this adapter.",
            },
            "last_error": self.last_error,
        }
