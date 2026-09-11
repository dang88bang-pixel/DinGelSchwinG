"""Contract tests for the bundled controller parser wire formats."""
from __future__ import annotations

import asyncio
import struct
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.moe.parsers.ninebot import NinebotParser
from app.moe.parsers.vesc import VescParser, crc16_ccitt


def vesc_packet(payload: bytes, large: bool = False) -> bytes:
    length = len(payload)
    header = b"\x03" + length.to_bytes(2, "big") if large else bytes([0x02, length])
    return header + payload + crc16_ccitt(payload).to_bytes(2, "big") + b"\x03"


def ninebot_packet(frame_type: int, payload: bytes) -> bytes:
    length = 1 + len(payload) + 1
    partial = b"\x55\xaa" + bytes([length, frame_type]) + payload
    return partial + bytes([sum(partial[2:]) & 0xFF])


class ParserTests(unittest.TestCase):
    def test_vesc_decodes_valid_small_and_large_value_packets(self) -> None:
        values = struct.pack(">hhffihfhf", 251, 278, 12.5, 4.25, -3, 175, 0.42, 1234, 50.2)
        parser = VescParser()
        for packet in (vesc_packet(b"\x04" + values), vesc_packet(b"\x04" + values, large=True)):
            parsed = asyncio.run(parser.parse_frame(packet))
            self.assertIsNotNone(parsed)
            assert parsed is not None
            self.assertEqual(parsed.protocol, "vesc")
            self.assertEqual(parsed.fields["temp_mos_c"], "25.1")
            self.assertEqual(parsed.fields["rpm"], "1234")
            self.assertEqual(parsed.fields["voltage_in_v"], "50.20")

    def test_vesc_rejects_bad_crc_and_short_values(self) -> None:
        good = bytearray(vesc_packet(b"\x04" + b"\x00" * 28))
        good[-2] ^= 0xFF
        self.assertIsNone(asyncio.run(VescParser().parse_frame(bytes(good))))
        short = vesc_packet(b"\x04" + b"\x00" * 27)
        self.assertIsNone(asyncio.run(VescParser().parse_frame(short)))

    def test_ninebot_decodes_telemetry_and_rejects_bad_lengths(self) -> None:
        packet = ninebot_packet(0x20, struct.pack(">Hhh", 36500, -1234, 278))
        parsed = asyncio.run(NinebotParser().parse_frame(packet))
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.fields, {"voltage_mv": "36500", "current_ma": "-1234", "speed_kmh": "27.8"})
        self.assertIsNone(asyncio.run(NinebotParser().parse_frame(packet[:-1])))
        corrupted = bytearray(packet)
        corrupted[-1] ^= 0x01
        self.assertIsNone(asyncio.run(NinebotParser().parse_frame(bytes(corrupted))))


if __name__ == "__main__":
    unittest.main()
