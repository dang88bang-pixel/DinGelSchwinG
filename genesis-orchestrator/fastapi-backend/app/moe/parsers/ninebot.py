"""Ninebot/Xiaomi UART telemetry parser with envelope and checksum validation."""
from __future__ import annotations

import struct

from ..base import ControllerParser, ParsedFrame

# REAL-IMPLEMENTATION 2026-09-11
HEADER = b"\x55\xaa"
_TELEMETRY_TYPE = 0x20
_TELEMETRY_FORMAT = ">Hhh"  # voltage mV, current mA, speed in 0.1 km/h
_TELEMETRY_SIZE = struct.calcsize(_TELEMETRY_FORMAT)


def decode_frame(raw: bytes) -> tuple[int, bytes] | None:
    """Validate a complete simplified Xiaomi frame and return type/payload."""
    # Header + length + type + checksum is the minimum legal packet.
    if len(raw) < 5 or not raw.startswith(HEADER):
        return None
    length = raw[2]  # type + payload + one checksum byte
    if length < 2 or len(raw) != length + 3:
        return None
    if (sum(raw[2:-1]) & 0xFF) != raw[-1]:
        return None
    return raw[3], raw[4:-1]


class NinebotParser(ControllerParser):
    protocol = "ninebot_uart"
    version = "1.1.0"

    async def parse_frame(self, raw: bytes) -> ParsedFrame | None:
        decoded = decode_frame(raw)
        if decoded is None:
            return None
        frame_type, payload = decoded
        if frame_type != _TELEMETRY_TYPE:
            return None
        return self._parse_telemetry(payload)

    @staticmethod
    def _parse_telemetry(payload: bytes) -> ParsedFrame | None:
        if len(payload) < _TELEMETRY_SIZE:
            return None
        voltage_mv, current_ma, speed_tenth_kmh = struct.unpack(_TELEMETRY_FORMAT, payload[:_TELEMETRY_SIZE])
        return ParsedFrame(
            protocol="ninebot_uart",
            fields={
                "voltage_mv": str(voltage_mv),
                "current_ma": str(current_ma),
                "speed_kmh": f"{speed_tenth_kmh / 10:.1f}",
            },
        )


PARSER_CLASS = NinebotParser
