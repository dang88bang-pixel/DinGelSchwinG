"""Example Ninebot/Xiaomi (UART) parser.

Decodes a simplified version of the Xiaomi/Ninebot serial protocol (binary
frame with a length/checksum trailer). Demonstrates the same `ControllerParser`
contract as the VESC example and is a candidate for dynamic hot-loading.
"""
from __future__ import annotations

import struct

from ..base import ControllerParser, ParsedFrame

# Simplified Xiaomi BMS/UART frame: 0x55 0xAA len type payload... checksum
HEADER = b"\x55\xaa"


class NinebotParser(ControllerParser):
    protocol = "ninebot_uart"
    version = "1.0.0"

    async def parse_frame(self, raw: bytes) -> ParsedFrame | None:
        if not raw.startswith(HEADER):
            return None
        if len(raw) < 5:
            return None

        length = raw[2]  # bytes after this field: type(1) + payload + checksum(1)
        if length + 3 != len(raw):
            return None  # length mismatch -> skip

        frame_type = raw[3]
        payload = raw[4 : 4 + length - 2]
        checksum = raw[-1]
        if (sum(raw[2:-1]) & 0xFF) != checksum:
            return None  # bad checksum

        if frame_type == 0x20:  # telemetry
            return self._parse_telemetry(payload)
        return None

    @staticmethod
    def _parse_telemetry(payload: bytes) -> ParsedFrame | None:
        if len(payload) < 4:
            return None
        voltage, current, speed = struct.unpack(">Hhh", payload[:6])
        return ParsedFrame(
            protocol="ninebot_uart",
            fields={
                "voltage_mv": str(voltage),
                "current_ma": str(current),
                "speed_kmh": f"{speed / 10:.1f}",
            },
        )
