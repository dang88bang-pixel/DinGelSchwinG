"""Scanner-Service: mDNS/SSDP/ARP + BLE (bleak) → WS-Push :8766.

Protokoll gemäß docs/api-websockets.md:
  {"type":"snapshot","nodes":[...]}, {"type":"update","node":...},
  {"type":"remove","id":...}
"""
from __future__ import annotations

import asyncio
import socket
import threading
import time
from typing import Any

from . import config
from .devices import arp_table, list_usb_dongles

try:
    from bleak import BleakScanner

    BLEAK_AVAILABLE = True
except Exception:  # noqa: BLE001
    BLEAK_AVAILABLE = False
    BleakScanner = None  # type: ignore[assignment]


class ScannerService:
    def __init__(self) -> None:
        self._nodes: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._subscribers: list[Any] = []
        self._running = False
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------------
    # Subscription (WS-Server hängt seine Broadcast-Queue an)
    # ------------------------------------------------------------------
    def subscribe(self, queue) -> None:
        self._subscribers.append(queue)

    def unsubscribe(self, queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def _broadcast(self, payload: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except Exception:  # noqa: BLE001 – Queue voll/geschlossen
                pass

    # ------------------------------------------------------------------
    # Lebenszyklus
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self._nodes.values())

    # ------------------------------------------------------------------
    def _loop(self) -> None:
        while self._running:
            try:
                self._scan_once()
            except Exception:  # noqa: BLE001
                pass
            time.sleep(config.SCAN_INTERVAL)

    def _scan_once(self) -> None:
        fresh: dict[str, dict[str, Any]] = {}
        now = time.time()

        # 1) BLE via bleak (echte Hardware, optional)
        if BLEAK_AVAILABLE and BleakScanner is not None:
            try:
                found = asyncio.run(BleakScanner.discover(timeout=4.0))
                for dev in found:
                    name = dev.name or "Unbekannt"
                    uuids = [str(u) for u in (dev.metadata.get("uuids") or [])] if dev.metadata else []
                    fresh[f"ble:{dev.address}"] = {
                        "id": f"ble:{dev.address}",
                        "kind": _classify(name, uuids),
                        "label": name,
                        "lastSeen": now,
                        "signal": {"rssi": int(dev.rssi or 0)},
                        "address": dev.address,
                        "serviceUuids": uuids,
                        "connectable": True,
                    }
            except Exception:  # noqa: BLE001 – Adapter fehlt
                pass

        # 1b) Virtuelle Peripherals (protokollkorrekter Stapel) → als BLE-Nodes
        try:
            from .virtual_ble import virtual_ble
            virtual_ble.start()
            for ev in virtual_ble.scan_events():
                fresh[f"ble:{ev['id']}"] = {
                    "id": f"ble:{ev['id']}",
                    "kind": {"token": "ble_token", "mesh": "ble_mesh",
                             "peripheral": "ble_peripheral"}.get(ev["deviceClass"], ev["deviceClass"]),
                    "label": ev["name"],
                    "lastSeen": now,
                    "signal": {"rssi": ev["rssi"]},
                    "address": ev["address"],
                    "serviceUuids": ev["serviceUuids"],
                    "connectable": True,
                    "virtual": True,
                }
        except Exception:  # noqa: BLE001
            pass

        # 2) USB-Dongles (kein Netz-Scan, statisch)
        for d in list_usb_dongles():
            if d["whitelisted"]:
                fresh[f"dongle:{d['vidHex']}:{d['pidHex']}"] = {
                    "id": f"dongle:{d['vidHex']}:{d['pidHex']}",
                    "kind": "dongle",
                    "label": d["name"],
                    "lastSeen": now,
                    "usbVendorId": d["vidHex"],
                    "usbProductId": d["pidHex"],
                    "autoBindable": True,
                }

        # 3) ARP (LAN-Geräte)
        for entry in arp_table():
            if entry.get("state") == "FAILED":
                continue
            ip = entry["ip"]
            fresh[f"net:{ip}"] = {
                "id": f"net:{ip}",
                "kind": "network",
                "label": ip,
                "lastSeen": now,
                "mac": entry.get("mac", ""),
                "state": entry.get("state", ""),
            }

        # Diff gegen alten Zustand → Broadcast (snapshot beim ersten Mal)
        with self._lock:
            old_ids = set(self._nodes)
            new_ids = set(fresh)
            removed = old_ids - new_ids
            added = new_ids - old_ids
            self._nodes = fresh

        if not old_ids:
            self._broadcast({"type": "snapshot", "nodes": list(fresh.values())})
            return

        for node_id in removed:
            self._broadcast({"type": "remove", "id": node_id})
        for node_id in added:
            self._broadcast({"type": "update", "node": fresh[node_id]})


def _classify(name: str, uuids: list[str]) -> str:
    hay = f"{name} {' '.join(uuids)}".lower()
    if any(w in hay for w in ("ntag", "nfc", "tracker")):
        return "ntag"
    if any(w in hay for w in ("beacon", "sensor", "aktor", "token", "temp")):
        return "ble_token"
    if "mesh" in hay:
        return "ble_mesh"
    return "ble_peripheral"


# Singleton
scanner = ScannerService()
