"""VESC UART parser for validated COMM_GET_VALUES packets.

The parser handles the official VESC small and large packet envelopes, including
CRC-16/CCITT verification and the terminal byte.  Unsupported commands are
ignored rather than guessed; telemetry fields only represent a validated packet.
"""
from __future__ import annotations

import struct

from ..base import ControllerParser, ParsedFrame

# REAL-IMPLEMENTATION 2026-09-11
START_SMALL = 2
START_LARGE = 3
END_BYTE = 3
_COMM_GET_VALUES = 4
_VALUES_FORMAT = ">hhffihfhf"
_VALUES_SIZE = struct.calcsize(_VALUES_FORMAT)


def crc16_ccitt(data: bytes) -> int:
    """VESC CRC-16 (poly 0x1021, initial value 0)."""
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def decode_packet(raw: bytes) -> bytes | None:
    """Return the VESC payload only when its full wire envelope is valid."""
    if len(raw) < 5 or raw[0] not in (START_SMALL, START_LARGE) or raw[-1] != END_BYTE:
        return None
    if raw[0] == START_SMALL:
        payload_length = raw[1]
        payload_start = 2
        expected_length = 1 + 1 + payload_length + 2 + 1
    else:
        if len(raw) < 6:
            return None
        payload_length = int.from_bytes(raw[1:3], "big")
        payload_start = 3
        expected_length = 1 + 2 + payload_length + 2 + 1
    if payload_length == 0 or len(raw) != expected_length:
        return None
    payload_end = payload_start + payload_length
    payload = raw[payload_start:payload_end]
    received_crc = int.from_bytes(raw[payload_end:payload_end + 2], "big")
    return payload if crc16_ccitt(payload) == received_crc else None


class VescParser(ControllerParser):
    protocol = "vesc"
    version = "1.1.0"

    async def parse_frame(self, raw: bytes) -> ParsedFrame | None:
        payload = decode_packet(raw)
        if not payload or payload[0] != _COMM_GET_VALUES:
            return None
        return self._parse_get_values(payload[1:])

    @staticmethod
    def _parse_get_values(body: bytes) -> ParsedFrame | None:
        if len(body) < _VALUES_SIZE:
            return None
        (
            temp_mos,
            temp_motor,
            current_motor,
            current_in,
            motor_id,
            motor_iq,
            duty,
            rpm,
            voltage_in,
        ) = struct.unpack(_VALUES_FORMAT, body[:_VALUES_SIZE])
        return ParsedFrame(
            protocol="vesc",
            fields={
                "temp_mos_c": f"{temp_mos / 10:.1f}",
                "temp_motor_c": f"{temp_motor / 10:.1f}",
                "current_motor_a": f"{current_motor:.2f}",
                "current_in_a": f"{current_in:.2f}",
                "motor_id": str(motor_id),
                "motor_iq_a": f"{motor_iq:.2f}",
                "rpm": f"{rpm:.0f}",
                "duty_cycle_percent": f"{duty * 100:.1f}",
                "voltage_in_v": f"{voltage_in:.2f}",
            },
        )


PARSER_CLASS = VescParser
