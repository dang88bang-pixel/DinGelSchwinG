"""Pairing- und Präsenz-Modelle."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Pairing:
    pid: str
    name: str
    device_ids: list[str] = field(default_factory=list)
    last_sync: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"pid": self.pid, "name": self.name, "deviceIds": self.device_ids, "lastSync": self.last_sync}


@dataclass
class ClientPresence:
    id: str
    role: str
    device: str = ""
    mode: str = "client"
    online: bool = True
    last_seen: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "device": self.device,
            "mode": self.mode,
            "online": self.online,
            "lastSeen": self.last_seen,
        }


@dataclass
class StatusEvent:
    type: str
    payload: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, **self.payload}
