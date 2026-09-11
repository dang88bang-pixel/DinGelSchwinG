"""Example VESC (Vedder Electronic Speed Controller) parser.

Implements a minimal subset of the VESC UART packet format to demonstrate the
`ControllerParser` contract. A production parser would additionally validate
CRCs, track the payload endianness, and map every COMM_GET_VALUES field.
"""
from __future__ import annotations

import struct

from ..base import ControllerParser, ParsedFrame

# VESC UART framing constants.
START_BYTE = 2  # small packet start byte
_COMM_GET_VALUES = 4


class VescParser(ControllerParser):
    protocol = "vesc"
    version = "1.0.0"

    async def parse_frame(self, raw: bytes) -> ParsedFrame | None:
        if not raw or raw[0] not in (2, 3):  # 2 = small, 3 = large frame
            return None

        payload = raw[1:-2]  # strip start byte + 2-byte CRC
        if len(payload) < 2:
            return None

        command = payload[0]
        if command == _COMM_GET_VALUES:
            return self._parse_get_values(payload[1:])
        return None

    @staticmethod
    def _parse_get_values(body: bytes) -> ParsedFrame | None:
        if len(body) < 14:
            return None
        # temp_mos, temp_motor, current_motor, current_in, id, iq, duty, rpm
        (temp_mos, temp_motor, current_motor, current_in, motor_id, motor_iq,
         duty, rpm, v_in) = struct.unpack(">hhffihfhf", body[:28])

        return ParsedFrame(
            protocol="vesc",
            fields={
                "temp_mos": f"{temp_mos / 10:.1f}",
                "temp_motor": f"{temp_motor / 10:.1f}",
                "current_motor": f"{current_motor:.2f}",
                "current_in": f"{current_in:.2f}",
                "rpm": f"{rpm:.0f}",
                "duty_cycle": f"{duty * 100:.1f}",
                "voltage_in": f"{v_in:.2f}",
            },
        )
